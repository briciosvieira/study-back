# Plataforma de Ensino (LMS) — NestJS + React

Documento de arquitetura e especificação técnica completa da plataforma.

> Este README serve como blueprint do projeto: modelagem de dados, estrutura de
> pastas do backend, contratos de API, regras de negócio e decisões de
> infraestrutura. Ele deve evoluir junto com o código.

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Papéis e permissões (RBAC)](#2-papéis-e-permissões-rbac)
3. [Arquitetura geral](#3-arquitetura-geral)
4. [Stack tecnológica](#4-stack-tecnológica)
5. [Modelagem de dados](#5-modelagem-de-dados)
6. [Estrutura de pastas do backend (NestJS)](#6-estrutura-de-pastas-do-backend-nestjs)
7. [Contratos de API (endpoints)](#7-contratos-de-api-endpoints)
8. [Regras de negócio críticas](#8-regras-de-negócio-críticas)
9. [Upload e armazenamento de arquivos](#9-upload-e-armazenamento-de-arquivos)
10. [Importação de perguntas via Excel](#10-importação-de-perguntas-via-excel)
11. [Motor do Quiz (regras detalhadas)](#11-motor-do-quiz-regras-detalhadas)
12. [Segurança](#12-segurança)
13. [Frontend (React) — organização sugerida](#13-frontend-react--organização-sugerida)
14. [Infraestrutura e deploy](#14-infraestrutura-e-deploy)
15. [Roadmap de desenvolvimento em fases](#15-roadmap-de-desenvolvimento-em-fases)

---

## 1. Visão geral

Plataforma de treinamento/educação com três perfis de usuário: **Administrador**,
**Técnico** e **Estudante**. Permite criar cursos organizados em módulos de
**PDF**, **Vídeo** e **Quiz (perguntas e respostas)**, com controle de
visibilidade por aluno, ordenação customizada de conteúdo, importação em massa
de perguntas via planilha Excel, e um motor de quiz com temporizador por
pergunta, sem possibilidade de voltar, e histórico de tentativas.

---

## 2. Papéis e permissões (RBAC)

| Ação | Admin | Técnico | Estudante |
|---|:---:|:---:|:---:|
| Deletar qualquer usuário (exceto outro admin) | ✅ | ❌ | ❌ |
| Criar curso / módulo | ✅ | ✅ | ❌ |
| Deletar curso / módulo / PDF / vídeo / pergunta | ✅ | ❌ | ❌ |
| Adicionar novo PDF / vídeo / pergunta | ✅ | ✅ | ❌ |
| Editar pergunta existente | ✅ | ✅ | ❌ |
| Importar perguntas via Excel | ✅ | ✅ | ❌ |
| Definir visibilidade de curso por aluno | ✅ | ✅ | ❌ |
| Definir visibilidade de módulo | ✅ | ✅ | ❌ |
| Visualizar PDF / assistir vídeo | ✅ | ✅ | ✅ (se visível) |
| Fazer quiz | ✅ | ✅ | ✅ (se visível) |
| Refazer quiz (quantas vezes quiser) | ✅ | ✅ | ✅ |

Regras confirmadas:
- **Técnico pode adicionar, mas nunca deletar** nada (curso, módulo, PDF,
  vídeo, pergunta ou usuário).
- **Apenas Admin deleta.** Admin não pode deletar outro Admin.
- **Qualquer perfil pode refazer o quiz quantas vezes quiser** — não há
  cooldown ou limite diário.

> Implementação: `@Roles('admin', 'tecnico')` como decorator + `RolesGuard`
> global, e uma verificação adicional a nível de serviço para ações de delete
> (`only admin`), já que "criar/editar" e "deletar" não têm o mesmo conjunto de
> roles permitidas mesmo dentro de uma rota semanticamente parecida.

---

## 3. Arquitetura geral

```
                         ┌─────────────────────┐
                         │   React (SPA/Vite)   │
                         │  admin / tecnico /   │
                         │      aluno UI        │
                         └──────────┬───────────┘
                                    │ HTTPS (REST + JWT)
                                    ▼
                         ┌─────────────────────┐
                         │   NestJS API         │
                         │  (Node.js, Fastify)  │
                         │                      │
                         │  Auth / Users        │
                         │  Cursos / Módulos    │
                         │  PDF / Vídeo         │
                         │  Quiz / Import       │
                         └───┬──────────┬───────┘
                             │          │
                 ┌───────────┘          └───────────┐
                 ▼                                  ▼
      ┌─────────────────────┐           ┌───────────────────────┐
      │   PostgreSQL         │           │  Object Storage        │
      │  (Prisma ORM)        │           │  S3 / Cloudflare R2     │
      │  usuários, cursos,   │           │  PDFs, vídeos, capas    │
      │  perguntas, respostas│           │  (upload via URL        │
      │  tentativas, etc.    │           │   assinada / presigned) │
      └─────────────────────┘           └───────────────────────┘
                                                    │
                                                    ▼
                                         ┌───────────────────────┐
                                         │  CDN / Streaming        │
                                         │  (Cloudflare Stream ou   │
                                         │   Mux) para vídeo        │
                                         └───────────────────────┘
```

Pontos-chave da arquitetura:
- **Backend stateless**, autenticação via JWT (access + refresh token).
- **Uploads pesados (PDF/vídeo) não passam pelo servidor Nest** — o backend
  apenas gera uma *presigned URL* e o front sobe o arquivo direto pro storage.
  Isso resolve o requisito de "PDF sem limite de tamanho" sem sobrecarregar a
  API.
- **Fila assíncrona (BullMQ + Redis)** para processar a importação de Excel
  (evita travar a requisição HTTP em planilhas grandes) e, opcionalmente, para
  processar transcodificação de vídeo se você não usar um serviço de streaming
  externo.
- **Banco relacional (PostgreSQL)** porque o domínio é fortemente relacional
  (curso → módulo → item → pergunta → tentativa → resposta).

---

## 4. Stack tecnológica

| Camada | Tecnologia | Motivo |
|---|---|---|
| Backend | NestJS (Node 20+, TypeScript) | requisito do projeto |
| ORM | Prisma | migrations tipadas, DX excelente com Nest |
| Banco | PostgreSQL | relacional, robusto, JSON support (jsonb) |
| Fila/Cache | Redis + BullMQ | processar import de Excel, jobs assíncronos |
| Storage de arquivos | S3 ou Cloudflare R2 | PDFs e vídeos, sem limite prático |
| Streaming de vídeo | Cloudflare Stream ou Mux (opcional) | evita servir vídeo cru |
| Autenticação | JWT (access + refresh) + Passport.js | padrão Nest |
| Parser de Excel | `exceljs` | leitura de `.xlsx` no backend |
| Geração de PDF viewer | `react-pdf` (frontend) | renderizar PDF no navegador |
| Frontend | React + Vite + TypeScript | requisito do projeto |
| Gerenciamento de estado | React Query (TanStack Query) | cache de dados servidor |
| Estilo | Tailwind CSS | produtividade |
| Validação | class-validator + class-transformer (Nest) / Zod (React) | |
| Testes | Jest (unit) + Supertest (e2e) | padrão Nest |
| Documentação de API | Swagger (`@nestjs/swagger`) | gerado automaticamente |

---

## 5. Modelagem de dados

### 5.1 Diagrama entidade-relacionamento (resumo)

```
User ──< CursoVisibilidade >── Curso ──< Modulo >──┬── PdfItem
  │                                                  ├── VideoItem
  │                                                  └── Pergunta ──< OpcaoPergunta
  │
  └──< TentativaQuiz >── Modulo
         └──< RespostaTentativa >── Pergunta
```

### 5.2 Schema Prisma (referência)

```prisma
// schema.prisma

enum Role {
  ADMIN
  TECNICO
  ESTUDANTE
}

enum TipoModulo {
  PDF
  VIDEO
  QUIZ
}

model User {
  id            String   @id @default(uuid())
  nome          String
  email         String   @unique
  senhaHash     String
  role          Role
  ativo         Boolean  @default(true)
  criadoEm      DateTime @default(now())

  cursosCriados      Curso[]           @relation("CursoCriador")
  visibilidades      CursoVisibilidade[]
  tentativas         TentativaQuiz[]

  @@map("users")
}

model Curso {
  id            String   @id @default(uuid())
  titulo        String
  descricao     String?
  capaUrl       String?
  ativo         Boolean  @default(true)
  criadoPorId   String
  criadoPor     User     @relation("CursoCriador", fields: [criadoPorId], references: [id])
  criadoEm      DateTime @default(now())

  modulos       Modulo[]
  visibilidades CursoVisibilidade[]

  @@map("cursos")
}

// Define para quais alunos aquele curso fica visível
model CursoVisibilidade {
  id        String  @id @default(uuid())
  cursoId   String
  userId    String
  curso     Curso   @relation(fields: [cursoId], references: [id], onDelete: Cascade)
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([cursoId, userId])
  @@map("curso_visibilidades")
}

model Modulo {
  id         String     @id @default(uuid())
  cursoId    String
  curso      Curso      @relation(fields: [cursoId], references: [id], onDelete: Cascade)
  tipo       TipoModulo
  titulo     String
  capaUrl    String?
  visivel    Boolean    @default(true)
  ordem      Float      @default(0) // ordena os módulos dentro do curso
  criadoEm   DateTime   @default(now())

  pdfItens   PdfItem[]
  videoItens VideoItem[]
  perguntas  Pergunta[]
  tentativas TentativaQuiz[]

  @@map("modulos")
}

model PdfItem {
  id           String   @id @default(uuid())
  moduloId     String
  modulo       Modulo   @relation(fields: [moduloId], references: [id], onDelete: Cascade)
  titulo       String
  arquivoUrl   String
  arquivoKey   String   // key no bucket S3/R2, para deletar depois
  tamanhoBytes BigInt?
  ordemLabel   String   // "1", "1.1", "2" — exibido na UI
  ordemNum     Float    // 1.0, 1.1, 2.0 — usado para ORDER BY
  criadoEm     DateTime @default(now())

  @@index([moduloId, ordemNum])
  @@map("pdf_itens")
}

model VideoItem {
  id           String   @id @default(uuid())
  moduloId     String
  modulo       Modulo   @relation(fields: [moduloId], references: [id], onDelete: Cascade)
  titulo       String
  arquivoUrl   String   // URL de streaming (Cloudflare Stream/Mux) ou storage
  arquivoKey   String?
  duracaoSeg   Int?
  ordemLabel   String
  ordemNum     Float
  criadoEm     DateTime @default(now())

  @@index([moduloId, ordemNum])
  @@map("video_itens")
}

model Pergunta {
  id              String   @id @default(uuid())
  moduloId        String
  modulo          Modulo   @relation(fields: [moduloId], references: [id], onDelete: Cascade)
  enunciado       String
  tempoLimiteSeg  Int      @default(205) // 3min25s
  ordem           Int      @default(0)
  criadoEm        DateTime @default(now())

  opcoes          OpcaoPergunta[]
  respostas       RespostaTentativa[]

  @@map("perguntas")
}

model OpcaoPergunta {
  id          String   @id @default(uuid())
  perguntaId  String
  pergunta    Pergunta @relation(fields: [perguntaId], references: [id], onDelete: Cascade)
  letra       String   // A, B, C, D, E, F...
  texto       String
  correta     Boolean  @default(false)

  @@unique([perguntaId, letra])
  @@map("opcoes_pergunta")
}

model TentativaQuiz {
  id            String    @id @default(uuid())
  moduloId      String
  modulo        Modulo    @relation(fields: [moduloId], references: [id], onDelete: Cascade)
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  iniciadoEm    DateTime  @default(now())
  finalizadoEm  DateTime?
  totalAcertos  Int?
  totalErros    Int?
  tempoTotalSeg Int?
  arquivada     Boolean   @default(false) // true quando o aluno clica "refazer"

  respostas     RespostaTentativa[]

  @@index([moduloId, userId, arquivada])
  @@map("tentativas_quiz")
}

model RespostaTentativa {
  id             String        @id @default(uuid())
  tentativaId    String
  tentativa      TentativaQuiz @relation(fields: [tentativaId], references: [id], onDelete: Cascade)
  perguntaId     String
  pergunta       Pergunta      @relation(fields: [perguntaId], references: [id], onDelete: Cascade)
  opcaoEscolhida String?       // letra escolhida, null se estourou o tempo
  correta        Boolean
  tempoGastoSeg  Int
  respondidoEm   DateTime      @default(now())

  @@unique([tentativaId, perguntaId])
  @@map("respostas_tentativa")
}
```

**Decisão de design — ordenação (`1`, `1.1`, `2`...):**
usar `ordemNum` (Float) para `ORDER BY` no banco e `ordemLabel` (String) só
para exibir. Isso evita o bug clássico de ordenar como texto (onde "10" vem
antes de "2"). Quando o usuário digita "1.1" no upload, o backend salva
`ordemLabel = "1.1"` e `ordemNum = 1.1`.

**Decisão de design — "refazer quiz":**
em vez de apagar de vez a tentativa anterior, ela é marcada como
`arquivada = true`. Isso preserva histórico para relatórios futuros (ex:
"quantas vezes o aluno tentou até acertar"), sem afetar a regra de negócio
("o aluno reinicia do zero visualmente"). Se você realmente preferir exclusão
física, é só trocar o `PATCH arquivada=true` por um `DELETE` em cascade — mas
recomendo manter o histórico.

---

## 6. Estrutura de pastas do backend (NestJS)

```
backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── config/
│   │   ├── configuration.ts          # carrega .env tipado
│   │   └── validation.schema.ts      # valida .env com Joi
│   │
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   │
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── dto/
│   │   │   ├── login.dto.ts
│   │   │   └── refresh-token.dto.ts
│   │   ├── strategies/
│   │   │   ├── jwt.strategy.ts
│   │   │   └── jwt-refresh.strategy.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   └── decorators/
│   │       ├── roles.decorator.ts
│   │       └── current-user.decorator.ts
│   │
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   └── dto/
│   │       ├── create-user.dto.ts
│   │       └── update-user.dto.ts
│   │
│   ├── cursos/
│   │   ├── cursos.module.ts
│   │   ├── cursos.controller.ts
│   │   ├── cursos.service.ts
│   │   └── dto/
│   │       ├── create-curso.dto.ts
│   │       ├── update-curso.dto.ts
│   │       └── set-visibilidade.dto.ts
│   │
│   ├── modulos/
│   │   ├── modulos.module.ts
│   │   ├── modulos.controller.ts
│   │   ├── modulos.service.ts
│   │   └── dto/
│   │       ├── create-modulo.dto.ts
│   │       └── update-modulo.dto.ts
│   │
│   ├── pdf/
│   │   ├── pdf.module.ts
│   │   ├── pdf.controller.ts
│   │   ├── pdf.service.ts
│   │   └── dto/
│   │       ├── create-pdf-item.dto.ts
│   │       └── reorder-pdf.dto.ts
│   │
│   ├── video/
│   │   ├── video.module.ts
│   │   ├── video.controller.ts
│   │   ├── video.service.ts
│   │   └── dto/
│   │       ├── create-video-item.dto.ts
│   │       └── reorder-video.dto.ts
│   │
│   ├── quiz/
│   │   ├── quiz.module.ts
│   │   ├── perguntas.controller.ts     # CRUD de pergunta
│   │   ├── perguntas.service.ts
│   │   ├── quiz-import.controller.ts   # upload de Excel
│   │   ├── quiz-import.service.ts
│   │   ├── quiz-import.processor.ts    # BullMQ worker
│   │   ├── tentativas.controller.ts    # iniciar/responder/finalizar/refazer
│   │   ├── tentativas.service.ts
│   │   └── dto/
│   │       ├── create-pergunta.dto.ts
│   │       ├── update-pergunta.dto.ts
│   │       ├── responder-pergunta.dto.ts
│   │       └── import-excel.dto.ts
│   │
│   ├── storage/
│   │   ├── storage.module.ts
│   │   ├── storage.service.ts          # abstração S3/R2 (presigned URLs)
│   │   └── storage.provider.interface.ts
│   │
│   ├── common/
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── interceptors/
│   │   │   └── transform-response.interceptor.ts
│   │   ├── pipes/
│   │   │   └── parse-uuid.pipe.ts
│   │   └── utils/
│   │       └── ordenacao.util.ts       # helpers de ordemNum/ordemLabel
│   │
│   └── health/
│       └── health.controller.ts
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                         # cria admin inicial + dados de teste
│
├── test/
│   ├── auth.e2e-spec.ts
│   ├── cursos.e2e-spec.ts
│   └── quiz.e2e-spec.ts
│
├── .env.example
├── docker-compose.yml                  # postgres + redis local
├── Dockerfile
├── package.json
└── tsconfig.json
```

---

## 7. Contratos de API (endpoints)

Todas as rotas (exceto `/auth/login`) exigem `Authorization: Bearer <token>`.
`[A]` = Admin, `[T]` = Técnico, `[E]` = Estudante.

### Auth
```
POST   /auth/login                     público
POST   /auth/refresh                   público (com refresh token)
POST   /auth/logout                    autenticado
GET    /auth/me                        autenticado
```

### Usuários
```
GET    /users                          [A]
POST   /users                          [A]
PATCH  /users/:id                       [A]
DELETE /users/:id                       [A]  (bloqueado se target.role === ADMIN)
```

### Cursos
```
GET    /cursos                          [A][T]  lista todos
GET    /cursos/meus                     [E]     lista só os visíveis pro aluno logado
GET    /cursos/:id                      [A][T][E]
POST   /cursos                          [A][T]
PATCH  /cursos/:id                       [A][T]
DELETE /cursos/:id                       [A]
PUT    /cursos/:id/visibilidade          [A][T]  body: { alunoIds: string[] }
```

### Módulos
```
GET    /cursos/:cursoId/modulos          [A][T][E]
POST   /cursos/:cursoId/modulos          [A][T]  body: { tipo, titulo, capaUrl }
PATCH  /modulos/:id                       [A][T]
DELETE /modulos/:id                       [A]
PATCH  /modulos/:id/visibilidade          [A][T]  body: { visivel: boolean }
```

### PDF
```
GET    /modulos/:moduloId/pdf                    [A][T][E]  lista ordenada
POST   /modulos/:moduloId/pdf/presign-upload      [A][T]     retorna URL assinada
POST   /modulos/:moduloId/pdf                     [A][T]     confirma metadata após upload
DELETE /pdf/:id                                    [A]
PATCH  /pdf/:id/reordenar                          [A][T]     body: { ordemLabel }
```

### Vídeo
```
GET    /modulos/:moduloId/video                   [A][T][E]
POST   /modulos/:moduloId/video/presign-upload      [A][T]
POST   /modulos/:moduloId/video                     [A][T]
DELETE /video/:id                                    [A]
PATCH  /video/:id/reordenar                          [A][T]
```

### Perguntas (CRUD manual)
```
GET    /modulos/:moduloId/perguntas       [A][T]     (aluno não vê a lista crua)
POST   /modulos/:moduloId/perguntas       [A][T]
PATCH  /perguntas/:id                      [A][T]
DELETE /perguntas/:id                      [A]
```

### Importação de perguntas via Excel
```
POST   /modulos/:moduloId/perguntas/import        [A][T]
       -> multipart/form-data com o arquivo .xlsx
       -> retorna { jobId } (processamento assíncrono via fila)

GET    /perguntas/import/:jobId/status            [A][T]
       -> { status: 'processando'|'concluido'|'erro',
            totalLinhas, importadas, comErro,
            erros: [{ linha, motivo }] }
```

### Quiz — execução (qualquer perfil autenticado, se módulo visível)
```
POST   /modulos/:moduloId/quiz/iniciar
       -> cria/retoma TentativaQuiz não-arquivada, retorna a 1ª pergunta
          (sem revelar a resposta correta) + tempoLimiteSeg

POST   /tentativas/:tentativaId/responder
       body: { perguntaId, opcaoEscolhida (nullable se estourou o tempo) }
       -> valida no backend se o tempo daquela pergunta já esgotou,
          grava RespostaTentativa, retorna a próxima pergunta
          ou { finalizado: true } se era a última

POST   /tentativas/:tentativaId/finalizar
       -> calcula totalAcertos/totalErros/tempoTotalSeg
       -> retorna o resultado completo: cada pergunta, opção escolhida,
          opção correta (para pintar de verde/vermelho no front)

POST   /modulos/:moduloId/quiz/refazer
       -> marca a tentativa atual como arquivada=true
       -> cria uma TentativaQuiz nova e limpa
       -> qualquer perfil, sem limite de quantas vezes
```

---

## 8. Regras de negócio críticas

1. **Hierarquia de exclusão:** somente `role === ADMIN` pode deletar. O
   `RolesGuard` cobre o nível de rota, mas a checagem "não pode deletar outro
   admin" precisa ser feita no `UsersService.remove()`, comparando o
   `role` do usuário-alvo.
2. **Técnico nunca deleta** — os controllers de `DELETE` em `Modulo`, `Pdf`,
   `Video`, `Pergunta` e `Curso` têm `@Roles('admin')` (não incluem
   `'tecnico'`), diferente dos `POST`/`PATCH` que incluem ambos.
3. **Visibilidade em duas camadas:** curso visível para o aluno
   (`CursoVisibilidade`) **e** módulo marcado como `visivel` dentro daquele
   curso. Um aluno só vê um módulo se as duas condições forem verdadeiras.
4. **Ordenação de conteúdo:** ao subir PDF/vídeo com um "número" (ex: `1.1`),
   grava `ordemNum` (float) e `ordemLabel` (string exibida). Listagem sempre
   ordena por `ordemNum ASC`.
5. **PDF sem limite de tamanho:** upload não passa pelo Nest — usa presigned
   URL direto pro bucket. O Nest só grava metadata depois do upload
   confirmado pelo front.
6. **Quiz — validação de tempo no servidor:** o front envia o tempo gasto,
   mas o backend recalcula com base em `respondidoEm - iniciadoEm da
   pergunta` e descarta a resposta como errada/tempo-esgotado se ultrapassar
   `tempoLimiteSeg` mesmo que o front tenha permitido o clique.
7. **Sem voltar no quiz:** não existe endpoint de "pergunta anterior".
   Cada `POST /responder` é definitivo — sem idempotência de reversão.
8. **Refazer:** disponível para qualquer perfil, sem limite de quantidade.
   Tecnicamente: `arquivar tentativa atual` + `criar nova`. Histórico de
   tentativas anteriores fica preservado (arquivada = true) para eventuais
   relatórios futuros do admin/técnico.

---

## 9. Upload e armazenamento de arquivos

Fluxo de upload de PDF (idêntico para vídeo, trocando o bucket/prefixo):

```
1. Front pede:  POST /modulos/:id/pdf/presign-upload
                body: { nomeArquivo, contentType }

2. Backend (StorageService):
   - gera uma key única: `cursos/{cursoId}/modulos/{moduloId}/{uuid}-{nomeArquivo}`
   - gera uma presigned URL do S3/R2 (expira em ~15 min)
   - retorna { uploadUrl, key }

3. Front faz PUT direto pro uploadUrl (sem passar pelo Nest) com o arquivo bruto.

4. Front confirma:  POST /modulos/:id/pdf
                     body: { titulo, key, ordemLabel }
   -> Nest valida que o objeto existe no bucket (HEAD request)
   -> grava PdfItem no banco com arquivoUrl (pública ou outra presigned de leitura)
```

Isso resolve "PDF sem limite de tamanho" sem estourar memória/timeout do
NestJS, e também escala melhor sob múltiplos uploads simultâneos.

Para vídeo, se o volume justificar, prefira **Cloudflare Stream** ou **Mux**:
você faz upload direto pra eles (mesma lógica de presigned URL, mas fornecida
pelo provedor de streaming), e eles cuidam de transcodificação adaptável
(HLS/DASH) — evita que o aluno com internet ruim trave assistindo vídeo em
1080p bruto.

---

## 10. Importação de perguntas via Excel

Template de planilha esperado (linha 1 = cabeçalho):

| Pergunta | A | B | C | D | E | Correta |
|---|---|---|---|---|---|---|
| Qual a capital do Brasil? | Rio de Janeiro | Brasília | São Paulo | Salvador | | B |

Regras do parser (`quiz-import.service.ts`):
- Colunas de letra são dinâmicas: se só existir A–D, ignora E/F. Se existir
  A–F, processa todas.
- Coluna `Correta` deve bater com uma letra que tenha texto preenchido —
  senão a linha entra em `erros`.
- Processamento roda em **job assíncrono (BullMQ)**: o endpoint de import
  retorna imediatamente um `jobId`, e o front faz polling em
  `GET /perguntas/import/:jobId/status` até `status: 'concluido'`.
- Relatório final não falha silenciosamente: cada linha inválida vira um item
  em `erros: [{ linha: 7, motivo: 'Coluna Correta vazia' }]`, e as linhas
  válidas são importadas mesmo assim.

---

## 11. Motor do Quiz (regras detalhadas)

```
┌──────────────┐    POST /iniciar     ┌───────────────────┐
│  Tela inicial │ ───────────────────▶│  Pergunta 1        │
│  do módulo    │                     │  (timer 3:25)      │
└──────────────┘                     └─────────┬──────────┘
                                                │ POST /responder
                                                ▼
                                      ┌───────────────────┐
                                      │  Pergunta 2        │  (não dá pra voltar)
                                      └─────────┬──────────┘
                                                │ ... até a última
                                                ▼
                                      ┌───────────────────┐
                                      │ POST /finalizar     │
                                      │ - tempo total        │
                                      │ - acertos/erros      │
                                      │ - gabarito em verde  │
                                      └─────────┬──────────┘
                                                │ POST /refazer
                                                ▼
                                      ┌───────────────────┐
                                      │ Tentativa arquivada  │
                                      │ Nova tentativa zerada│
                                      └───────────────────┘
```

Detalhes de implementação do timer:
- Ao servir uma pergunta, o backend grava (em memória/redis ou no próprio
  registro) o timestamp de quando ela foi exibida.
- O front roda um countdown visual de `tempoLimiteSeg` (205s por padrão,
  mas configurável por pergunta).
- Se o aluno não responde a tempo, o front dispara automaticamente
  `POST /responder` com `opcaoEscolhida: null`, e o backend marca como
  errada.
- Mesmo que o front seja manipulado (dev tools), o backend recalcula o tempo
  real gasto (`agora - timestamp_exibicao`) e invalida respostas fora do
  prazo — **a fonte da verdade do tempo é sempre o servidor.**

Resultado final (`POST /finalizar`) retorna algo como:

```json
{
  "totalPerguntas": 10,
  "totalAcertos": 7,
  "totalErros": 3,
  "tempoTotalSeg": 940,
  "detalhes": [
    {
      "pergunta": "Qual a capital do Brasil?",
      "opcaoEscolhida": "A",
      "opcaoCorreta": "B",
      "correta": false
    }
  ]
}
```

O front usa `opcaoCorreta` para pintar de verde e `opcaoEscolhida` (quando
diferente e incorreta) para pintar de vermelho.

---

## 12. Segurança

- **JWT access token** (curta duração, ~15min) + **refresh token** (httpOnly
  cookie, ~7 dias) — evita XSS roubar o refresh token via `localStorage`.
- **RolesGuard global** lendo metadata de `@Roles(...)`.
- **Rate limiting** (`@nestjs/throttler`) nas rotas de login e de resposta de
  quiz (evita brute-force e scripts automatizados "batendo" respostas).
- **Validação de payload** com `class-validator` em todos os DTOs.
- **Helmet** + CORS restrito ao domínio do frontend.
- **Presigned URLs com expiração curta** (10–15 min) para upload e leitura de
  arquivos privados.
- **Auditoria (opcional, recomendado):** tabela `AuditLog` registrando quem
  deletou o quê e quando — útil já que só admin deleta, e é importante ter
  rastreabilidade.

---

## 13. Frontend (React) — organização sugerida

```
frontend/
├── src/
│   ├── app/
│   │   ├── routes/
│   │   │   ├── admin/           # /admin/*
│   │   │   ├── tecnico/         # /tecnico/*
│   │   │   └── aluno/           # /aluno/*
│   │   └── router.tsx           # guards por role
│   ├── features/
│   │   ├── auth/
│   │   ├── cursos/
│   │   ├── modulos/
│   │   ├── pdf/
│   │   │   └── PdfViewer.tsx    # react-pdf, com zoom e navegação
│   │   ├── video/
│   │   │   └── VideoPlayer.tsx
│   │   └── quiz/
│   │       ├── QuizRunner.tsx   # state machine da prova
│   │       ├── useQuizTimer.ts  # hook do countdown
│   │       └── QuizResultado.tsx
│   ├── shared/
│   │   ├── api/                 # cliente axios/fetch + React Query hooks
│   │   ├── components/
│   │   └── hooks/
│   └── main.tsx
```

Pontos de atenção no front:
- `QuizRunner` deve ser uma state machine simples (ex: `useReducer`) com
  estados `carregando → respondendo → proxima → finalizado`, sem permitir
  transição de volta.
- `PdfViewer` com `react-pdf`: renderiza o PDF completo com zoom (`react-pdf`
  suporta paginação e escala), e um botão "voltar" que desmonta o viewer e
  volta pra lista de PDFs do módulo.
- Rotas protegidas por role usando um `<RequireRole roles={['admin']}>`
  wrapper que redireciona se o usuário não tiver permissão.

---

## 14. Infraestrutura e deploy

Sugestão simples para começar (fácil de escalar depois):

- **Backend:** Railway, Render ou um VPS com Docker Compose.
- **Banco:** PostgreSQL gerenciado (Neon, Supabase ou RDS).
- **Storage:** Cloudflare R2 (sem custo de egress, compatível com S3 SDK).
- **Vídeo:** Cloudflare Stream (paga por minuto armazenado + assistido).
- **Redis:** Upstash (serverless, plano free razoável) para BullMQ.
- **Frontend:** Vercel ou Cloudflare Pages.

`docker-compose.yml` local sugerido (dev) — credenciais sempre via `.env`, nunca hardcoded no compose:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports: ["5432:5432"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
```

---

## 15. Roadmap de desenvolvimento em fases

**Fase 1 — Fundação**
- Setup NestJS + Prisma + Postgres, autenticação JWT, seed do admin inicial.
- CRUD de usuários (admin).

**Fase 2 — Cursos e módulos**
- CRUD de Curso, Módulo, visibilidade por aluno.
- Upload de capa.

**Fase 3 — Conteúdo (PDF/Vídeo)**
- Presigned upload, listagem ordenada, reordenação (`1`, `1.1`, `2`).
- Viewer de PDF no front (zoom, navegação).

**Fase 4 — Quiz (núcleo)**
- CRUD manual de pergunta/opções.
- Motor de execução do quiz (iniciar/responder/finalizar), timer validado
  no backend, tela de resultado com gabarito colorido.
- Refazer (arquivar + nova tentativa).

**Fase 5 — Importação em massa**
- Upload de Excel, fila BullMQ, relatório de erros linha a linha.

**Fase 6 — Polimento**
- Auditoria de exclusões, rate limiting, testes e2e das rotas críticas
  (login, delete com regras de role, quiz completo), documentação Swagger.

---

*Documento gerado como base de arquitetura — ajuste os nomes de campos e
rotas livremente conforme o projeto evoluir. Recomendo manter este arquivo
atualizado a cada decisão técnica relevante.*
