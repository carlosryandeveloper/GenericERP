# GenericERP

Um mini-ERP modular para demonstrar processos clássicos (cadastros → movimentações → histórico → relatórios), com API documentada e banco relacional.

## Stack (v0.1)
- Backend: FastAPI (Python) + SQLModel
- Banco: PostgreSQL
- Infra: Docker Compose

## Como rodar (Docker)
```bash
docker compose up --build
```

- Health: http://localhost:8000/health  
- Swagger (OpenAPI): http://localhost:8000/docs  

## Endpoints atuais
- `POST /products` – cria produto
- `GET /products` – lista produtos
- `POST /stock/movements` – cria movimentação (IN/OUT/TRANSFER/ADJUST)
- `GET /stock/movements` – lista movimentações

## Observações
- Não commite segredos (.env). Use variáveis de ambiente.
