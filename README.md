# Compiler Backend

Simple Express backend with:

- Existing code execution endpoint at `POST /run`
- Secure Gemini proxy at `POST /api/ai/chat`
- Environment-based secrets
- CORS, Helmet, validation, and basic rate limiting

## Folder structure

```text
.
|-- server.js
|-- index.js
|-- src
|   |-- app.js
|   |-- middleware
|   |   `-- error.middleware.js
|   |-- routes
|   |   |-- ai.routes.js
|   |   `-- compiler.routes.js
|   `-- services
|       `-- gemini.service.js
|-- .env.example
`-- package.json
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your environment file:

```bash
cp .env.example .env
```

3. Add your Gemini key to `.env`:

```env
GEMINI_API_KEY=your_real_key_here
```

4. Start the server:

```bash
npm run dev
```

Or for production:

```bash
npm start
```

## Environment variables

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | Server port |
| `GEMINI_API_KEY` | Yes for AI chat | None | Gemini API key used only on the server |
| `GEMINI_MODEL` | No | `gemini-3-flash-preview` | Gemini model name |
| `GEMINI_API_BASE_URL` | No | `https://generativelanguage.googleapis.com/v1beta` | Gemini base URL |
| `CORS_ORIGIN` | No | Allow all origins | Comma-separated allowed origins |
| `AI_RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate-limit window in milliseconds |
| `AI_RATE_LIMIT_MAX` | No | `30` | Max AI requests per window per IP |

## AI endpoint

### Request

`POST /api/ai/chat`

```json
{
  "message": "How do I fix this loop?",
  "codeContext": "for(int i=0;i<n;i--){}",
  "language": "cpp"
}
```

### Success response

```json
{
  "success": true,
  "reply": "Use i++ instead of i-- so the loop can terminate correctly."
}
```

### Error response

```json
{
  "success": false,
  "error": "Readable error message"
}
```

## Example Flutter request

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

Future<String> askAi({
  required String message,
  String codeContext = '',
  String language = 'cpp',
}) async {
  final uri = Uri.parse('https://your-backend-domain.com/api/ai/chat');

  final response = await http.post(
    uri,
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'message': message,
      'codeContext': codeContext,
      'language': language,
    }),
  );

  final data = jsonDecode(response.body) as Map<String, dynamic>;

  if (response.statusCode == 200 && data['success'] == true) {
    return data['reply'] as String;
  }

  throw Exception(data['error'] ?? 'AI request failed');
}
```

## Deployment

### Render

1. Create a new Web Service from this repo.
2. Set the build command to `npm install`.
3. Set the start command to `npm start`.
4. Add environment variables like `GEMINI_API_KEY`, `GEMINI_MODEL`, and `CORS_ORIGIN`.

### Railway

1. Create a new project from the repo.
2. Railway will usually detect Node automatically.
3. Add the same environment variables in the project settings.
4. Deploy and use the generated public URL.

### Vercel

1. This code is easiest to run on Render or Railway because it is an always-on Express server.
2. If you use Vercel, convert `src/app.js` into a serverless handler or wrap it with Vercel's Node runtime entrypoint.
3. Add the same environment variables in the Vercel dashboard before deployment.

## Security notes

- The Gemini API key stays only in `process.env.GEMINI_API_KEY`
- The backend composes the final prompt server-side
- The API key is never returned to the client
- Internal stack traces are not exposed in API responses
- Avoid logging request bodies if they may contain sensitive code

## Important

The Gemini API key should be treated as compromised if it has ever been placed in frontend code or shared publicly. Rotate it in Google AI Studio or your Google Cloud setup before using this backend in production.
