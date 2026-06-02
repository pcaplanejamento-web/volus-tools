# RELATÓRIO TÉCNICO — INTEGRAÇÃO API VÓLUS

**Documento:** Relatório de problemas identificados na integração
**Data:** 29 de maio de 2026
**Versão:** 1.0

---

## DADOS DA INTEGRAÇÃO

| Campo | Valor |
|---|---|
| **Cliente solicitante** | Prefeitura Municipal de Rio Verde (PMRV) |
| **Código Vólus** | 000600-000138 (entre as 11 empresas autorizadas) |
| **Responsável** | Jhone Sousa Costa — Coordenador de Planejamento das Contratações e Gestão de Custos / PMRV |
| **E-mail** | jhone.sousa@rioverde.go.gov.br |
| **Contato anterior** | Roger Lima (roger@volus.com) · Lucas Andrade (tecnologia@volus.com) |
| **Credenciais emitidas em** | 27/05/2026 às 15:59 (e-mail Roger → Larissa Kelly) |
| **Histórico relevante** | Solicitação original de 25/05/2026 — Larissa Kelly Cruvinel da Silva |

---

## CREDENCIAIS UTILIZADAS NOS TESTES

```
ClientID:     52cb732b-d904-0aa0-e063-326fa8c0d811
Client Secret: A723A490C3882C7DFC8E698CE3345BBE
```

> Estas credenciais autenticam com sucesso (HTTP 200) no endpoint
> `POST https://auth.api.volus.com/v1/partners/auth/token`,
> retornando token JWE válido por 1h com acesso às 11 empresas do nosso grupo
> e aos scopes `api-extrato` e `api-vehicles`.

---

## RESUMO EXECUTIVO

A integração com a API Vólus encontra-se **parcialmente funcional**. Em 99 chamadas executadas (11 empresas × múltiplos endpoints):

| Categoria | Quantidade | Situação |
|---|---:|---|
| ✅ Funcionando perfeitamente | 15 chamadas | Sem ação requerida |
| 🚨 **Erro 500 — bug no servidor Vólus** | **7 chamadas** | **AÇÃO REQUERIDA pelo time técnico Vólus** |
| ⛔ Erro 403 — endpoint sem permissão | 11 chamadas | Confirmação requerida |
| 💼 Erro 403 — fora do contrato | 66 chamadas | Negociação comercial |

**Dados já extraídos com sucesso:** 20.298 transações de abastecimento das 3 empresas do produto Abastecimento (códigos 000617-*).

**Dados pendentes:** 100% das transações de Manutenção das 7 empresas afetadas pelo bug 500.

---

## SEÇÃO 1 — PROBLEMA CRÍTICO: HTTP 500 INESPERADO NO ENDPOINT DE MANUTENÇÃO

### 1.1. Identificação do problema

**Endpoint afetado:** `GET https://extrato.api.volus.com/v1/fleet/maintenance/statement`

**Mensagem retornada pelo servidor:**
```json
{
  "response_code": 500,
  "message": "Erro inesperado! Caso persista, informe o código abaixo ao time de suporte Vólus.\n\n{request_id}",
  "data": null
}
```

### 1.2. Empresas afetadas (7 de 8 do produto Manutenção)

| # | Código Cliente | company_id | Razão Social | CNPJ | Request-ID Vólus (logs internos) |
|---|---|---|---|---|---|
| 1 | 000600-000138 | 000600000138 | MUNICIPIO DE RIO VERDE | 02.056.729/0001-05 | `77df33f50a614d5a6769efba053c2d32` |
| 2 | 000600-000140 | 000600000140 | FUNDO MUNICIPAL DE EDUCACAO DE RIO VERDE | 26.903.042/0001-26 | `1b668d5ddf9cfc5904212f09c025da5b` |
| 3 | 000600-000141 | 000600000141 | AGENCIA MUNICIPAL DE MOBILIDADE E TRANSITO DE RIO VERDE | 05.054.206/0001-18 | `d1166c54693435cc4c3142472dd11fe3` |
| 4 | 000600-000142 | 000600000142 | FUNDO MUNICIPAL DE ASSISTENCIA SOCIAL DE RIO VERDE | 01.806.908/0001-50 | `587bdbec8ff2a4ad7d2a750669a80c2a` |
| 5 | 000600-000143 | 000600000143 | FUNDO MUNICIPAL DE PROTECAO E DEFESA DO CONSUMIDOR | 00.618.216/0001-15 | `3f7db2eb274c26520c4b2501fa3d71a1` |
| 6 | 000600-000224 | 000600000224 | FUND ESPEC MUNIC PARA O CORPO DE BOMB DO ESTAD DE GOIAIS RV | 04.424.486/0001-46 | `a74a85bb42004c2cb14b619ce2323ae4` |
| 7 | 000600-000235 | 000600000235 | FUND MUN DE DES ECON SUSTENTAVEL FMDES | 35.615.310/0001-03 | `60239c15ec38a45fbab21697111abbbf` |

### 1.3. Empresa não afetada (controle)

| Código Cliente | company_id | Razão Social | Comportamento |
|---|---|---|---|
| 000600-000144 | 000600000144 | FUNDO MUNICIPAL DE SAUDE | ✅ HTTP 200 OK normal (0 ordens no período, retorno válido) |

### 1.4. Padrão técnico observado

- A empresa **000600-000144 (FMS Saúde)** processa corretamente
- As outras **7 empresas do produto 000600-*** falham com 500
- Sugere que algum **campo ou registro específico** dessas empresas dispara exception no parser/serializer do servidor
- O bug é **determinístico** (reprodutível 100% das tentativas)
- A autenticação está OK (token JWE válido)
- Os parâmetros estão no formato correto (`company_id` de 12 dígitos)

### 1.5. Reprodução do problema

**cURL para reproduzir (basta substituir o token):**

```bash
curl -X GET \
  'https://extrato.api.volus.com/v1/fleet/maintenance/statement?start_date=2026-01-01&end_date=2026-05-29&company_id=000600000138' \
  -H 'accept: application/json' \
  -H 'Authorization: Bearer <SEU_JWE_AQUI>'
```

### 1.6. Ação solicitada

**Solicitamos ao time técnico da Vólus:**

1. Investigar o stack-trace dos request-IDs listados na Seção 1.2
2. Identificar o campo/registro que dispara a exception
3. Aplicar correção no parser ou no dado problemático
4. Confirmar resolução para que possamos reprocessar a extração

**Impacto operacional:** sem manutenções dessas 7 empresas, o PMRV não consegue gerar relatórios consolidados de gastos por secretaria, prejudicando o **Plano de Contratações Anuais** (finalidade declarada na solicitação original de 25/05).

### 1.7. PROBLEMA COMPOSTO — respostas HTTP 500 SEM headers CORS

Durante a validação no navegador, identificamos um **segundo bug** que agrava o problema anterior:

**As respostas HTTP 500 do endpoint `/v1/fleet/maintenance/statement` NÃO incluem os headers CORS** (`Access-Control-Allow-Origin`, etc).

Headers efetivamente retornados na resposta 500:
```
Content-Type: application/json
Content-Length: 165
```

Headers ausentes (presentes nas respostas 200):
```
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Credentials: true
```

**Consequência:** o navegador bloqueia a resposta 500 antes do código JavaScript conseguir lê-la (CORS error → `TypeError: Failed to fetch`), impossibilitando até mesmo o tratamento e log do erro do lado do cliente.

**Verificação técnica:** chamadas via Python (que ignora CORS) recebem normalmente o HTTP 500 com body válido. Chamadas via navegador (que respeita CORS) falham com "Failed to fetch".

**Correção solicitada:** garantir que **todas as respostas** (2xx, 4xx, 5xx) incluam os headers CORS quando o pedido vier de origem autorizada. Esse é um requisito da especificação CORS (W3C) — middlewares de erro devem propagar os headers de origem.

---

## SEÇÃO 1-A — INCONSISTÊNCIA NOS VALORES MONETÁRIOS (descoberta em 29/05)

### 1-A.1. Identificação

Os campos `unit_price` e `total_value` dentro de `product[]` no endpoint `/v1/fleet/fuel/statement` retornam valores **100× maiores do que o esperado**, sugerindo que a API está enviando em **centavos sem conversão pra Reais** — ou alguma outra anomalia.

### 1-A.2. Evidências

Exemplos extraídos das 20.298 transações reais da PMRV (29/05/2026):

| Placa | Combustível | Quantidade (L) | unit_price retornado | unit_price esperado | Discrepância |
|---|---|---:|---:|---:|---|
| NLH9F29 | DIESEL COMUM S500 | 105,00 | **R$ 661,50/L** | ~R$ 6,62/L | **100× maior** |
| NLH9F29 | DIESEL COMUM S500 | 73,00 | **R$ 457,71/L** | ~R$ 4,58/L | **100× maior** |
| NLH9F29 | DIESEL COMUM S500 | 108,00 | **R$ 677,16/L** | ~R$ 6,77/L | **100× maior** |
| NLH9F29 | DIESEL COMUM S500 | 112,68 | **R$ 889,05/L** | ~R$ 8,89/L | **100× maior** |

> Preço real do diesel S500 no mercado brasileiro: **R$ 5,50 a R$ 7,00 por litro**.

### 1-A.3. Impacto

- **Total geral retornado pela API**: R$ 1.390.593.191,93 (R$ 1,39 bilhões)
- **Total real estimado** (÷ 100): R$ 13.905.931,92 (R$ 13,9 milhões)
- 201 transações com valor > R$ 1 milhão (inviável para abastecimentos individuais)
- 11.213 transações com valor > R$ 10.000

Os valores absurdos invalidam qualquer relatório de gestão sem ajuste manual.

### 1-A.4. Ação solicitada

**Esclarecer com a equipe técnica Vólus:**

1. O campo `unit_price` e `total_value` retornam em **centavos** (precisamos dividir por 100)?
2. Se sim, isso deveria estar documentado no Swagger
3. Se não, há bug no serializer dos valores monetários
4. Caso seja em centavos, considerar adicionar tipo de unidade na resposta (ex.: `"currency": "BRL", "scale": 100`)

---

## SEÇÃO 2 — HTTP 403 EM TODAS AS EMPRESAS NO ENDPOINT DE AERONAVES

### 2.1. Identificação

**Endpoint afetado:** `GET https://vehicles.api.volus.com/v1/aircrafts`

**Resposta do servidor:**
```json
{
  "response_code": 403,
  "message": "Acesso negado.",
  "data": null
}
```

### 2.2. Empresas afetadas

**Todas as 11 empresas** retornam HTTP 403 sem exceção.

### 2.3. Esclarecimento solicitado

A Prefeitura Municipal de Rio Verde **não opera frota aérea**. O retorno HTTP 403 pode ser:

a) **Comportamento esperado** — endpoint reservado para clientes com frota aérea contratada
b) **Falha de provisionamento** — endpoint deveria responder 200 OK com lista vazia

**Solicitação:** confirmação por escrito sobre o comportamento esperado. Se for o caso (a), removeremos este endpoint da nossa integração. Se for (b), solicitamos liberação de permissão de leitura.

---

## SEÇÃO 3 — ACESSO AO SERVIÇO `cartoes.api.volus.com` (FORA DO ESCOPO ATUAL)

### 3.1. Identificação

**Serviço afetado:** `https://cartoes.api.volus.com` (API de Gestão de Cartões para Emissores)

**Mensagem do servidor:** `"Token não possui acesso ao recurso"` (distinta do "Acesso negado" da Seção 2)

**Endpoints testados que retornaram 403 (66 chamadas no total):**
- `GET /v1/organization/balance` (saldo do parceiro)
- `GET /v1/organization/statement` (extrato consolidado)
- `GET /v1/cards` (cartões físicos)
- `GET /v1/invoices` (faturas)
- `GET /v1/mcc-groups` (grupos MCC)
- `GET /v1/anonymous` (cartões anônimos)

### 3.2. Natureza

Os scopes retornados pelo endpoint de autenticação são:
```json
"scope": [
  { "service_name": "api-extrato",  "base_url": "https://extrato.api.volus.com" },
  { "service_name": "api-vehicles", "base_url": "https://vehicles.api.volus.com" }
]
```

`api-cartoes` **não está incluso**. Trata-se de **questão contratual**, não de falha técnica.

### 3.3. Solicitação

Caso o PMRV tenha interesse comercial em acessar esses recursos (saldo do parceiro, gestão de faturas, MCC, cartões anônimos/virtuais), favor encaminhar para a equipe comercial da Vólus o orçamento de extensão do contrato.

---

## SEÇÃO 4 — INFORMAÇÕES TÉCNICAS COMPLEMENTARES

### 4.1. Histórico de revisões da API durante a integração

Durante o desenvolvimento, observamos **três mudanças no contrato da API** em poucas horas:

| Data/hora | Mudança | Detalhe |
|---|---|---|
| 27/05 ~15:59 | Credenciais emitidas | Roger envia ClientID/Secret de parceiro |
| 28/05 ~16:42 | Parâmetro alterado | `client_code` + `branch_code` → `client_id` (12 dígitos) |
| 29/05 ~17:00 | Parâmetro alterado novamente | `client_id` → `company_id` |

> **Sugestão de melhoria:** comunicar quebras de contrato com antecedência ou manter versionamento (`/v2/...`).

### 4.2. Conformidade observada com RFCs

- ✅ Autenticação compatível com **RFC 6749 (OAuth 2.0)** — `grant_type=client_credentials`
- ✅ Token compatível com **RFC 7516 (JWE)** — algoritmo `dir + A256GCM`, 5 segmentos compactos
- ✅ CORS configurado para `http://localhost:5173` (verificado em preflight OPTIONS)
- ⚠️ Tempo de resposta de algumas chamadas excede 20s (000617-000002 com 11.736 transações em 22s) — sugere falta de paginação no endpoint

### 4.3. Volume de dados extraído com sucesso

| Empresa | Transações | Tamanho payload |
|---|---:|---:|
| 000617-000002 (Município RV - Abast) | 11.736 | 12.16 MB |
| 000617-000003 (Assist Social - Abast) | 593 | 594.8 KB |
| 000617-000004 (Saúde - Abast) | 7.969 | 8.18 MB |
| **TOTAL** | **20.298 transações** | **~20.95 MB** |

---

## SEÇÃO 5 — RESUMO DAS AÇÕES SOLICITADAS

| # | Prioridade | Descrição | Responsável Vólus |
|---|---|---|---|
| **1** | 🔴 **CRÍTICA** | Corrigir HTTP 500 no `/v1/fleet/maintenance/statement` para as 7 empresas listadas na Seção 1.2 | Time técnico/DevOps |
| **2** | 🟡 Média | Confirmar comportamento esperado do `/v1/aircrafts` (Seção 2.3) | Roger / time API |
| **3** | 🟢 Baixa | Avaliar oferta comercial para incluir `api-cartoes` no escopo (Seção 3.3) | Comercial |
| **4** | 🟢 Baixa | Considerar versionamento de API para futuras quebras de contrato (Seção 4.1) | Arquitetura |

---

## SEÇÃO 6 — DADOS DE CONTATO E DISPONIBILIDADE

| Canal | Contato |
|---|---|
| E-mail | jhone.sousa@rioverde.go.gov.br |
| WhatsApp | (em conversa direta com Roger Lima) |
| Disponibilidade para call técnica | Qualquer dia útil, 09h–17h horário de Brasília |

Aguardamos retorno com prazo estimado para resolução do item crítico (Seção 1) e esclarecimento dos itens 2 e 3.

Atenciosamente,

**Jhone Sousa Costa**
Coordenador de Planejamento das Contratações e Gestão de Custos
Prefeitura Municipal de Rio Verde — PMRV
Código Vólus: 000600-000138

---

## ANEXO A — TABELA COMPLETA DE ENDPOINTS TESTADOS

### A.1. Endpoints com sucesso

| Endpoint | company_id | HTTP | Resultado |
|---|---|---|---|
| `/v1/fleet/fuel/statement` | 000617000002 | 200 | 11.736 transações |
| `/v1/fleet/fuel/statement` | 000617000003 | 200 | 593 transações |
| `/v1/fleet/fuel/statement` | 000617000004 | 200 | 7.969 transações |
| `/v1/fleet/maintenance/statement` | 000600000144 | 200 | 0 ordens (válido) |
| `/v1/fleet/fuel/statement` | demais 7 empresas | 200 | 0 transações (esperado — empresas não usam o produto) |
| `/v1/fleet/maintenance/statement` | 000617000002–4 | 200 | 0 ordens (esperado) |

### A.2. Endpoints com erro 500 (bug Vólus)

| Endpoint | company_id | HTTP | Request-ID |
|---|---|---|---|
| `/v1/fleet/maintenance/statement` | 000600000138 | 500 | 77df33f50a614d5a6769efba053c2d32 |
| `/v1/fleet/maintenance/statement` | 000600000140 | 500 | 1b668d5ddf9cfc5904212f09c025da5b |
| `/v1/fleet/maintenance/statement` | 000600000141 | 500 | d1166c54693435cc4c3142472dd11fe3 |
| `/v1/fleet/maintenance/statement` | 000600000142 | 500 | 587bdbec8ff2a4ad7d2a750669a80c2a |
| `/v1/fleet/maintenance/statement` | 000600000143 | 500 | 3f7db2eb274c26520c4b2501fa3d71a1 |
| `/v1/fleet/maintenance/statement` | 000600000224 | 500 | a74a85bb42004c2cb14b619ce2323ae4 |
| `/v1/fleet/maintenance/statement` | 000600000235 | 500 | 60239c15ec38a45fbab21697111abbbf |

### A.3. Endpoints com erro 403

| Endpoint | Empresas afetadas | Mensagem |
|---|---|---|
| `/v1/aircrafts` | Todas as 11 | "Acesso negado." |
| `cartoes.api.volus.com/v1/*` (6 endpoints) | Todas as 11 | "Token não possui acesso ao recurso." |

---

## ANEXO B — EXEMPLO DE REQUISIÇÃO E RESPOSTA (HTTP 500)

### Requisição

```http
GET /v1/fleet/maintenance/statement?start_date=2026-01-01&end_date=2026-05-29&company_id=000600000138 HTTP/1.1
Host: extrato.api.volus.com
Accept: application/json
Authorization: Bearer eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..<...JWE truncado...>
```

### Resposta

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json
x-request-id: 77df33f50a614d5a6769efba053c2d32

{
  "response_code": 500,
  "message": "Erro inesperado! Caso persista, informe o código abaixo ao time de suporte Vólus.\n\n77df33f50a614d5a6769efba053c2d32",
  "data": null
}
```

---

**FIM DO DOCUMENTO**
