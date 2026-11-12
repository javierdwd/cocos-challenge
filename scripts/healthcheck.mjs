const port = process.env.PORT ?? '3000';

try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) {
    console.error(`Health check failed with HTTP ${response.status}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error('Health check failed:', error);
  process.exitCode = 1;
}
