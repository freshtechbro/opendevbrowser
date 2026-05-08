const resolveWorkerCount = (itemCount: number, limit: number): number => {
  if (itemCount <= 0) return 0;
  const finiteLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
  return Math.min(Math.max(1, finiteLimit), itemCount);
};

export const mapBounded = async <Input, Output>(
  items: readonly Input[],
  limit: number,
  task: (item: Input, index: number) => Promise<Output>
): Promise<Output[]> => {
  const results: Output[] = new Array<Output>(items.length);
  let cursor = 0;
  let firstError: Error | null = null;
  const workers = Array.from({ length: resolveWorkerCount(items.length, limit) }, async () => {
    for (;;) {
      if (firstError) return;
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index] as Input, index);
      } catch (error) {
        if (!firstError) {
          firstError = error instanceof Error ? error : new Error(String(error));
        }
        return;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
  return results;
};
