// Suppress expected console.error output from Express global error handler
// during integration tests. 4xx/5xx errors logged by the app are intentional
// (e.g. "creates 400 for missing name" tests) and would otherwise flood output.
const originalError = console.error.bind(console);
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const msg = String(args[0] ?? '');
    if (msg.includes('❌ Error:')) return;
    originalError(...args);
  });
});
afterAll(() => {
  (console.error as jest.Mock).mockRestore?.();
});
