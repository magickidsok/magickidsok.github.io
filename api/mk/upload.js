import { handleUpload } from '@vercel/blob/client';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = request.body;

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['video/mp4'],
        maximumSizeInBytes: 4000000000,
        addRandomSuffix: true,
        cacheControlMaxAge: 31536000,
        tokenPayload: JSON.stringify({ source: 'magic-kids-panel' })
      })
    });

    return response.status(200).json(jsonResponse);
  } catch (error) {
    return response.status(400).json({
      error: error instanceof Error ? error.message : 'No se pudo autorizar la subida'
    });
  }
}
