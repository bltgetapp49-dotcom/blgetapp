# bitrewards

Express + EJS wallet app with MongoDB.

## Run locally

```bash
npm install
npm start
```

Local app runs at `http://localhost:3000`.

## Deploy on Vercel (Serverless)

This project is configured for Vercel serverless deployment:

- `api/index.js` exports the Express app for Vercel
- `vercel.json` rewrites all routes to that serverless function
- `app.js` holds the Express app and DB/session setup

Set these Vercel environment variables:

- `MONGODB_URI` (required)
- `SESSION_SECRET` (required)
- `ADMIN_PASSWORD` (recommended)
- `TELEGRAM_USERNAME` (optional)

After setting variables, deploy with the Vercel dashboard or CLI.
