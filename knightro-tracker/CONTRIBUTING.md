# Contributing

## Workflow

1. Pull the latest `main`: `git pull`
2. Make a branch: `git checkout -b your-name/short-description`
3. Commit small, focused changes with clear messages.
4. Push and open a pull request into `main`. Ask a teammate to review.
5. Merge once it works locally and someone has looked at it.

Don't push directly to `main` during the hackathon crunch unless the team agrees.

## Who owns what

| Folder | Owner | Notes |
|---|---|---|
| `frontend/` | Frontend | Plain HTML/CSS/JS, no build step |
| `backend/` | Backend | AWS Lambda (Python) + API Gateway |
| `scraper/` | Events | Knight Connect scraper Lambda |
| `data/` | Shared | `buildings.json` is used by the frontend and the scraper |
| `docs/` | Everyone | API contract, screenshots |

## Rules that keep the app safe

- **Never commit secrets.** No AWS access keys, `.env` files or credentials. `.gitignore` blocks the common ones; double-check `git status` before committing.
- **Captions are untrusted.** Strangers type them. In the frontend, insert them with `textContent` or text nodes, never `innerHTML`.
- **Keep the API contract current.** If a route changes, update `docs/api-contract.md` in the same pull request.

## Running the frontend

Serve the repo root so `data/buildings.json` loads:

```bash
python -m http.server 8000
```

Then open http://localhost:8000/frontend/. Opening `frontend/index.html` directly also works, but location labels fall back to "On campus" because browsers block reading local JSON files.
