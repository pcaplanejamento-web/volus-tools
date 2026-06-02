// volus-importer.js
// =====================================================================
// Lógica de importação da API Vólus — módulo ES puro, sem dependências
// Funciona em Node 18+, Deno, Bun e browsers (fetch nativo)
// Extraído de volus-tools/index.html · 2026-06-02
// =====================================================================

// ---------------------------------------------------------------------
// 1. CLIENT_MAP — empresas PMRV vinculadas ao contrato Vólus
//    cada entry diz qual endpoint a empresa consome (fuel ou maint)
// ---------------------------------------------------------------------
export const CLIENT_MAP = {
  // Abastecimento
  '000617000002': { alias: '617-002', label: 'PMRV',                  fullName: 'Prefeitura Municipal de Rio Verde',          product: 'fuel'  },
  '000617000003': { alias: '617-003', label: 'FMAS',                  fullName: 'Fundo Municipal de Assistência Social',      product: 'fuel'  },
  '000617000004': { alias: '617-004', label: 'FMS',                   fullName: 'Fundo Municipal de Saúde',                   product: 'fuel'  },
  // Manutenção
  '000600000138': { alias: '600-138', label: 'MUNICIPIO E SAÚDE',     fullName: 'Município e Saúde',                          product: 'maint' },
  '000600000140': { alias: '600-140', label: 'FME',                   fullName: 'Fundo Municipal de Educação',                product: 'maint' },
  '000600000141': { alias: '600-141', label: 'AMT',                   fullName: 'Agência Municipal de Trânsito',              product: 'maint' },
  '000600000142': { alias: '600-142', label: 'FMAS',                  fullName: 'Fundo Mun. Assist. Social',                  product: 'maint' },
  '000600000143': { alias: '600-143', label: 'PROCON',                fullName: 'Fundo PROCON',                               product: 'maint' },
  '000600000144': { alias: '600-144', label: 'DADOS ANTIGOS SAÚDE',   fullName: 'Dados antigos Saúde',                        product: 'maint' },
  '000600000235': { alias: '600-235', label: 'FMDES',                 fullName: 'Fundo M. Des. Econ. Sustentável',            product: 'maint' },
  '000600000224': { alias: '600-224', label: 'FEMBOM',                fullName: 'Fundo Especial Bombeiros',                   product: 'maint' },
};

// ---------------------------------------------------------------------
// 2. ENDPOINTS
// ---------------------------------------------------------------------
export const ENDPOINTS = {
  AUTH:  'https://auth.api.volus.com/v1/partners/auth/token',
  FUEL:  'https://extrato.api.volus.com/v1/fleet/fuel/statement',
  MAINT: 'https://extrato.api.volus.com/v1/fleet/maintenance/statement',
};

// ---------------------------------------------------------------------
// 3. AUTH — OAuth2 client_credentials (RFC 6749 §4.4)
//    body: x-www-form-urlencoded · retorna { access_token, expires_in, companies, scope }
// ---------------------------------------------------------------------
export async function authenticate({ client_id, client_secret, url = ENDPOINTS.AUTH }) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id, client_secret }),
  });
  if (!r.ok) {
    const text = await r.text();
    let msg = text; try { msg = JSON.parse(text).message || text; } catch {}
    throw new Error(`Auth HTTP ${r.status}: ${msg}`);
  }
  const data = await r.json();
  if (!data.access_token) throw new Error('Auth response sem access_token');
  return {
    access_token: data.access_token,
    token_type:   data.token_type || 'Bearer',
    expires_in:   data.expires_in || 3600,
    expires_at:   Date.now() + (data.expires_in || 3600) * 1000,
    companies:    (data.companies || []).sort((a, b) => (a.id || '').localeCompare(b.id || '')),
    scope:        data.scope || [],
  };
}

// ---------------------------------------------------------------------
// 4. BUILD QUEUE — roteamento por produto (CLIENT_MAP define qual ep)
// ---------------------------------------------------------------------
export function buildQueue(companies, { start, end }) {
  const queue = [];
  for (const c of companies) {
    const map = CLIENT_MAP[c.id];
    if (!map) continue; // empresa fora do contrato PMRV → ignora
    const params = new URLSearchParams({ start_date: start, end_date: end, company_id: c.id });
    if (map.product === 'fuel') {
      queue.push({ ep: 'fuel',  url: `${ENDPOINTS.FUEL}?${params}`,  company: c, map });
    } else if (map.product === 'maint') {
      queue.push({ ep: 'maint', url: `${ENDPOINTS.MAINT}?${params}`, company: c, map });
    }
  }
  return queue;
}

// ---------------------------------------------------------------------
// 5. FETCH com retry + exponential backoff + AbortController
//    onLog opcional pra observabilidade
// ---------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function fetchWithRetry(item, { token, maxRetries = 3, timeoutMs = 5 * 60 * 1000, onLog = () => {} } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const r = await fetch(item.url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: ctrl.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);
      const ms = Date.now() - t0;
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch {}

      if (r.status === 200 && json) {
        const data = json.data || json;
        const txs  = data.transactions || [];
        // Detector de paginação — se essas keys aparecerem, podemos estar perdendo páginas
        const pagiKeys = ['next_page','next_url','has_more','has_next','total_pages','total_count','pagination','links','_links','meta','page','offset','limit']
          .filter(k => data[k] !== undefined || json[k] !== undefined);
        onLog({ status: 200, ep: item.ep, url: item.url, ms, txCount: txs.length, attempt, pagiKeys });
        return { ok: true, status: 200, txs, raw: json, pagiKeys };
      }

      // 5xx → retry
      if (r.status >= 500 && attempt < maxRetries) {
        onLog({ status: r.status, ep: item.ep, url: item.url, ms, attempt, retrying: true });
        await sleep(800 * Math.pow(2, attempt));
        continue;
      }

      const errMsg = json?.message || text.slice(0, 200);
      onLog({ status: r.status, ep: item.ep, url: item.url, ms, attempt, error: errMsg });
      return { ok: false, status: r.status, error: errMsg };
    } catch (e) {
      clearTimeout(timeoutId);
      const friendly = e.name === 'AbortError'
        ? `Timeout >${timeoutMs}ms`
        : (e.message === 'Failed to fetch' || /NetworkError/i.test(e.message))
          ? 'Failed to fetch (provável HTTP 500 sem CORS — bug Vólus)'
          : e.message;
      if (attempt < maxRetries) {
        onLog({ status: 0, ep: item.ep, url: item.url, ms: 0, attempt, retrying: true, error: friendly });
        await sleep(800 * Math.pow(2, attempt));
        continue;
      }
      onLog({ status: 0, ep: item.ep, url: item.url, ms: 0, attempt, error: friendly });
      return { ok: false, status: 0, error: friendly };
    }
  }
}

// ---------------------------------------------------------------------
// 6. POOL paralelo com cap de concorrência
// ---------------------------------------------------------------------
export async function runPool(queue, runner, concurrency = 11) {
  let idx = 0;
  const results = new Array(queue.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (idx < queue.length) {
      const myIdx = idx++;
      results[myIdx] = await runner(queue[myIdx], myIdx);
    }
  }));
  return results;
}

// ---------------------------------------------------------------------
// 7. FIELD HELPERS — bug-aware das diferenças de schema fuel × maint
//    (descoberto via Inspetor de JSON 2026-06-02)
//
//    fuel.product[].total_value  → CENTAVOS (dividir por 100)
//    maint.products[].total_price → REAIS    (não dividir)
//    fuel.unit.name              → 'FMAS'
//    maint.unit.description      → 'ADMINISTRACAO'
// ---------------------------------------------------------------------
const nz = v => (+v || 0);

/** Total agregado de combustível em REAIS (converte total_value de centavos) */
export function fuelTotalBRL(r) {
  return (r.product || []).reduce((s, p) => s + nz(p?.total_value) / 100, 0);
}

/** Total agregado de manutenção em REAIS (com fallback chain) */
export function maintTotalBRL(r) {
  // Canonical: products[].total_price em reais
  const tp = (r.products || []).reduce((s, p) => s + nz(p?.total_price), 0);
  if (tp > 0) return tp;
  // Legacy: products[].total_value em centavos
  const tv = (r.products || []).reduce((s, p) => s + nz(p?.total_value) / 100, 0);
  if (tv > 0) return tv;
  // Campos alternativos no produto (assume reais)
  for (const f of ['cost','value','price','amount','gross_value','net_value','total']) {
    const sum = (r.products || []).reduce((s, p) => s + nz(p?.[f]), 0);
    if (sum > 0) return sum;
  }
  // Total no nível da transação
  if (r.total_price != null) return nz(r.total_price);
  if (r.total_value != null) return nz(r.total_value) / 100;
  if (r.amount      != null) return nz(r.amount);
  // Em invoice
  if (r.invoice?.total_price != null) return nz(r.invoice.total_price);
  if (r.invoice?.total_value != null) return nz(r.invoice.total_value) / 100;
  const invSum = nz(r.invoice?.product_invoice_value) + nz(r.invoice?.service_invoice_value);
  if (invSum > 0) return invSum;
  return 0;
}

/** Unidade da manutenção (prioriza .description que a Vólus usa em maint) */
export function maintUnit(r) {
  return r.unit?.description
      || r.unit?.name || r.unit?.code
      || r.unit_name
      || r.organizational_unit?.description || r.organizational_unit?.name || r.organizational_unit?.code
      || r.cost_center?.description || r.cost_center?.name || r.cost_center?.code
      || null;
}

/** Empenho da manutenção (5 paths · fuel.purchase_order.commitment_number funciona direto) */
export function maintCommitment(r) {
  return r.purchase_order?.commitment_number
      || r.commitment_number
      || r.invoice?.commitment_number
      || r.invoice?.purchase_order?.commitment_number
      || r.products?.[0]?.purchase_order?.commitment_number
      || null;
}

/** Processo da manutenção */
export function maintProcess(r) {
  return r.purchase_order?.process_number
      || r.process_number
      || r.invoice?.process_number
      || null;
}

// ---------------------------------------------------------------------
// 8. NORMALIZERS — converte registro da API em linha plana pra DB
//    Use estes pra fazer INSERT/UPSERT direto na sua tabela.
//    Chaves snake_case, valores normalizados (CNPJ sem máscara, etc).
// ---------------------------------------------------------------------

/** Combustível → linha plana */
export function normalizeFuelRow(r, company) {
  const p0 = (r.product || [])[0] || {};
  const map = CLIENT_MAP[company.id] || {};
  return {
    transaction_id:               r.id != null ? String(r.id) : null,
    company_id:                   company.id,
    company_alias:                map.alias || null,
    company_label:                map.label || company.name,
    // datas
    refuel_datetime:              r.refuel_datetime || null,
    refuel_date:                  r.refuel_datetime ? r.refuel_datetime.slice(0, 10) : null,
    // veículo
    plate:                        r.card?.plate || r.card?.prefix || null,
    prefix:                       r.card?.prefix || null,
    brand_name:                   r.card?.brand_name || null,
    model_name:                   r.card?.model_name || null,
    manufacture_year:             r.card?.manufacture_year != null ? Number(r.card.manufacture_year) : null,
    card_masked:                  r.card?.card_masked || null,
    // operador
    operator_name:                r.operator?.name || null,
    operator_license:             r.operator?.license || null,
    operator_cpf:                 r.operator?.id_number || null,
    // mercante (posto)
    merchant_name:                r.merchant?.name || null,
    merchant_legal_name:          r.merchant?.legal_name || null,
    merchant_cnpj:                r.merchant?.cnpj ? String(r.merchant.cnpj).replace(/\D/g, '') : null,
    merchant_state_registration:  r.merchant?.state_registration || null,
    merchant_street:              r.merchant?.address?.street || null,
    merchant_district:            r.merchant?.address?.district || null,
    merchant_city:                r.merchant?.address?.city || null,
    merchant_state:               r.merchant?.address?.state || null,
    merchant_zip:                 r.merchant?.address?.zip_code ? String(r.merchant.address.zip_code).replace(/\D/g, '') : null,
    merchant_phone:               r.merchant?.contact?.phone || null,
    // produto principal (caso multi-produto, ver normalizeFuelItems)
    product_name:                 p0.name || null,
    product_quantity:             p0.quantity != null ? nz(p0.quantity) : null,
    product_unit_price_brl:       p0.unit_price != null ? nz(p0.unit_price) / 100 : null,
    product_total_value_brl:      p0.total_value != null ? nz(p0.total_value) / 100 : null,
    // total agregado (soma de todos os produtos em REAIS)
    total_value_brl:              fuelTotalBRL(r),
    // odômetro
    accumulated_distance:         r.accumulated_distance ? nz(r.accumulated_distance) : null,
    distance_traveled:            r.distance_traveled    ? nz(r.distance_traveled)    : null,
    average_consumption:          r.average_consumption  ? nz(r.average_consumption)  : null,
    // fiscal
    fiscal_document:              r.fiscal_document || null,
    is_billed:                    typeof r.is_billed === 'boolean' ? r.is_billed : null,
    // empenho
    commitment_number:            r.purchase_order?.commitment_number || null,
    process_number:               r.purchase_order?.process_number || null,
    // unidade
    unit_name:                    r.unit?.name || r.unit?.code || null,
    // raw (debug/audit)
    raw_json:                     r,
    ingested_at:                  new Date().toISOString(),
  };
}

/** Itens individuais de combustível (linhas separadas) */
export function normalizeFuelItems(r) {
  return (r.product || []).map((p, i) => ({
    transaction_id:    r.id != null ? String(r.id) : null,
    line_no:           i + 1,
    name:              p.name || null,
    quantity:          nz(p.quantity),
    unit_price_brl:    nz(p.unit_price) / 100,
    total_value_brl:   nz(p.total_value) / 100,
  }));
}

/** Manutenção → linha plana (header) */
export function normalizeMaintRow(r, company) {
  const map = CLIENT_MAP[company.id] || {};
  return {
    order_id:                     r.order_id != null ? String(r.order_id) : null,
    company_id:                   company.id,
    company_alias:                map.alias || null,
    company_label:                map.label || company.name,
    // datas
    transaction_datetime:         r.transaction_datetime || null,
    transaction_date:             r.transaction_datetime ? r.transaction_datetime.slice(0, 10) : null,
    // veículo
    plate:                        r.card?.plate || r.card?.prefix || null,
    prefix:                       r.card?.prefix || null,
    brand_name:                   r.card?.brand_name || null,
    model_name:                   r.card?.model_name || null,
    manufacture_year:             r.card?.manufacture_year != null ? Number(r.card.manufacture_year) : null,
    card_masked:                  r.card?.card_masked || null,
    // operador
    operator_name:                r.operator?.name || null,
    operator_license:             r.operator?.license || null,
    operator_cpf:                 r.operator?.id_number || null,
    // mercante (oficina)
    merchant_name:                r.merchant?.name || null,
    merchant_legal_name:          r.merchant?.legal_name || null,
    merchant_cnpj:                r.merchant?.cnpj ? String(r.merchant.cnpj).replace(/\D/g, '') : null,
    merchant_state_registration:  r.merchant?.state_registration || null,
    merchant_street:              r.merchant?.address?.street || null,
    merchant_district:            r.merchant?.address?.district || null,
    merchant_city:                r.merchant?.address?.city || null,
    merchant_state:               r.merchant?.address?.state || null,
    merchant_zip:                 r.merchant?.address?.zip_code ? String(r.merchant.address.zip_code).replace(/\D/g, '') : null,
    merchant_phone:               r.merchant?.contact?.phone || null,
    // total — JÁ EM REAIS (Vólus envia total_price em reais, não centavos)
    total_value_brl:              maintTotalBRL(r),
    // contexto
    maintenance_type:             r.maintenance_context?.maintenance_type || null,
    usage_metric:                 r.maintenance_context?.usage_metric || null,
    // fiscal
    product_invoice_number:       r.invoice?.product_invoice_number || null,
    service_invoice_number:       r.invoice?.service_invoice_number || null,
    // empenho — Vólus retorna null com frequência (escalar Roger)
    commitment_number:            maintCommitment(r),
    process_number:               maintProcess(r),
    // unidade — usa .description que é o canonical na API maint
    unit_name:                    maintUnit(r),
    // contagem de itens (peças + serviços)
    items_count:                  (r.products || []).length,
    // raw
    raw_json:                     r,
    ingested_at:                  new Date().toISOString(),
  };
}

/** Itens de manutenção (peças + serviços, linhas separadas) */
export function normalizeMaintItems(r) {
  return (r.products || []).map((p, i) => ({
    order_id:          r.order_id != null ? String(r.order_id) : null,
    line_no:           i + 1,
    description:       p.description || null,
    category:          p.category?.name || null,
    item_type:         p.item_type?.description || null,
    item_type_id:      p.item_type?.id != null ? Number(p.item_type.id) : null,
    quantity:          nz(p.quantity),
    unit_price_brl:    nz(p.unit_price),    // já em reais
    total_price_brl:   nz(p.total_price),   // já em reais
  }));
}

// ---------------------------------------------------------------------
// 9. ORQUESTRADOR de alto nível — extractAll
//    • autentica
//    • monta queue (CLIENT_MAP determina o ep de cada empresa)
//    • dispara pool paralelo
//    • re-autentica automaticamente se TTL expirar mid-flight
//    • coleta resultados + erros + warnings de paginação
//
//    Retorno:
//    {
//      fuel:    [tx, ...],   // transações com _company anexado
//      maint:   [tx, ...],
//      errors:  [{ep, company, status, error}, ...],
//      missing_companies: ['000xxx...'],
//      pagination_warnings: [{ep, company_id, keys: [...]}, ...],
//      stats: { fuel_count, maint_count, error_count, started_at, finished_at, elapsed_ms }
//    }
// ---------------------------------------------------------------------
export async function extractAll({ credentials, start, end, onLog, onProgress, concurrency = 11 } = {}) {
  onLog      ||= () => {};
  onProgress ||= () => {};
  const started_at = Date.now();

  // ---- Auth ----
  let session = await authenticate(credentials);
  onLog({ type: 'auth', companies: session.companies.length, scope: session.scope });

  // ---- Detecta empresas faltantes ----
  const expected = Object.keys(CLIENT_MAP);
  const returned = new Set(session.companies.map(c => c.id));
  const missing_companies = expected.filter(id => !returned.has(id));
  if (missing_companies.length) {
    onLog({ type: 'warn', message: `Auth retornou ${session.companies.length}/${expected.length} empresas`, missing: missing_companies });
  }

  // ---- Build queue ----
  const queue = buildQueue(session.companies, { start, end });
  onLog({ type: 'queue', total: queue.length });

  // ---- Containers ----
  const fuel = [];
  const maint = [];
  const errors = [];
  const pagination_warnings = [];
  let done = 0;

  // ---- Runner com token-refresh ----
  const runner = async (item) => {
    // Token refresh se expirado (margem de 60s)
    if (!session || Date.now() > session.expires_at - 60_000) {
      onLog({ type: 'token-refresh' });
      session = await authenticate(credentials);
    }
    const res = await fetchWithRetry(item, { token: session.access_token, onLog });
    done++;
    onProgress({ done, total: queue.length, pct: Math.round(done * 100 / queue.length), ep: item.ep, company: item.company.id });

    if (res.ok) {
      const list = item.ep === 'fuel' ? fuel : maint;
      for (const tx of res.txs) list.push({ ...tx, _company: item.company });
      if (res.pagiKeys?.length) {
        pagination_warnings.push({ ep: item.ep, company_id: item.company.id, keys: res.pagiKeys });
      }
    } else {
      errors.push({ ep: item.ep, company: item.company, status: res.status, error: res.error });
    }
    return res;
  };

  // ---- Pool ----
  await runPool(queue, runner, concurrency);

  const finished_at = Date.now();
  return {
    fuel,
    maint,
    errors,
    missing_companies,
    pagination_warnings,
    stats: {
      fuel_count:  fuel.length,
      maint_count: maint.length,
      error_count: errors.length,
      started_at:  new Date(started_at).toISOString(),
      finished_at: new Date(finished_at).toISOString(),
      elapsed_ms:  finished_at - started_at,
    },
  };
}
