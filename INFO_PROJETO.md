# Açaineiro - Informações do Projeto

## URLs
- **Sistema (Painel Admin):** https://sistemaacaineiro.netlify.app/admin/
- **Site do Cliente (PWA):** https://sistemaacaineiro.netlify.app/
- **GitHub:** https://github.com/Acaieniro/Acaineiro_erp
- **Netlify (deploys):** https://app.netlify.com/projects/sistemaacaineiro/overview
- **Turso (banco):** https://app.turso.tech/acaieniro?group=default

## Acesso
| Serviço | Email | Senha |
|---------|-------|-------|
| Todos | acaineiro3@gmail.com | acaineiro@2026. |
| Netlify | acaineiro04@gmail.com | acaineiro@2026. |

## Stack
- **Frontend Admin:** HTML/CSS/JS puro (arquivo único)
- **Banco:** Turso (SQLite cloud, libsql)
- **Imagens:** Cloudinary
- **Hospedagem:** Netlify (serverless functions)
- **Impressão:** Print-agent local (Node.js + USB)
- **PWA Cliente:** www/ (copiado no build)

## Credenciais Importantes
- **Admin Password:** acaineiro@2026. (hardcoded no código, não precisa de env var)
- **Turso:** URL e token no `.env` local (backend/.env)
- **Cloudinary:** API Key/Secret no `.env` local

## Comandos
| Ação | Comando |
|------|---------|
| Rodar local | `npm start` (na pasta backend/) |
| Deploy Netlify | `npm run netlify` (ou push no master) |
| Print-agent local | `node print-agent.js` (na pasta acaineiro-print-service/) |
