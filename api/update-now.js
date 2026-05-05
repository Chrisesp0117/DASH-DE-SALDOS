/**
 * UPDATE-NOW endpoint: serves an HTML page that triggers update and auto-closes
 * GET /api/update-now?secret=<token> → returns HTML page that calls /api/cron/update
 */

module.exports = (req, res) => {
  const secret = req.query?.secret || req.headers?.['x-cron-secret'] || '';
  const expectedSecret = process.env.CRON_SECRET || 'default-secret';

  if (!secret || secret !== expectedSecret) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }

  // HTML page that triggers update and closes itself
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atualizando Planilha...</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
      padding: 40px;
      text-align: center;
      max-width: 400px;
      width: 100%;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid #f0f0f0;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      margin: 0 auto 20px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    h1 {
      color: #333;
      font-size: 24px;
      margin-bottom: 10px;
    }
    .status {
      color: #666;
      font-size: 14px;
      line-height: 1.6;
    }
    .status strong {
      color: #667eea;
    }
    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Atualizando Planilha</h1>
    <div class="status">
      <p>Sua planilha está sendo atualizada em tempo real.</p>
      <p>A aba <strong>Última Atualização</strong> mostrará <strong>"Atualizando..."</strong> enquanto o processo estiver em andamento.</p>
      <p style="margin-top: 10px; font-size: 12px; color: #999;">Esta janela fechará automaticamente quando terminar.</p>
    </div>
  </div>

  <script>
    (async function() {
      try {
        const secret = '${secret}';
        
        // Trigger the update endpoint
        const response = await fetch('/api/cron/update?batchSize=100', {
          method: 'GET',
          headers: {
            'x-cron-secret': secret
          }
        });

        const data = await response.json();
        console.log('Update response:', data);

        // Wait a moment and close the window
        setTimeout(() => {
          window.close();
        }, 1500);
      } catch (error) {
        console.error('Error triggering update:', error);
        // Still close even if error
        setTimeout(() => {
          window.close();
        }, 3000);
      }
    })();
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
};
