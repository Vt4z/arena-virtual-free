import { handleApi } from '../lib/application.js';

export default async function handler(request, response) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
    await handleApi(request, response, url);
  } catch (error) {
    console.error('Falha na API do Vestiário:', error?.name || 'Error');
    response.statusCode = 500;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: 'Não foi possível concluir a solicitação.' }));
  }
}
