# StreamlineAI ChatbotIQ

Generic chatbot engine. CONFIG-per-client deployment. Phase 1 stack: Railway backend + Netlify frontend + Anthropic API.

## Versions
- **V1.0** — Web chat → Anthropic API → reply. No memory, no KB.
- V1.1+ planned per `D2 Master Prompt v1.2`.

## Stack
- Backend: Node 20, Express, `@anthropic-ai/sdk` — deploys to Railway
- Frontend: HTML/CSS/JS — deploys to Netlify
- Model: `claude-sonnet-4-5`

## Local development
```bash
cd backend
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

Then open `frontend/index.html` and edit `chat.js` line 7 to point `BACKEND_URL` at `http://localhost:3000`.

## Environment variables (Railway)
- `ANTHROPIC_API_KEY` — required
- `ALLOWED_ORIGIN` — set to your Netlify URL (e.g. `https://streamlineai-chatbotiq.netlify.app`) for production. Defaults to `*` for dev.
- `PORT` — Railway sets this automatically.

## Rollback
Each version is git-tagged (`v1.0`, `v1.1`, etc). To rollback:
```bash
git revert <commit>
git push
```
Railway will auto-deploy the reverted commit. To rollback in Railway UI: Deployments tab → previous deployment → Redeploy.

## Architecture
See `D2 Master Prompt v1.2` and `StreamlineAI_Agent_Methodology_v1.md` for the patterns this engine implements.