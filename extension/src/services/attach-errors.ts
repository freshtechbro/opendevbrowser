const ATTACH_BLOCKED_ERROR_MARKERS = [
  "Not allowed",
  "Another debugger is already attached"
];

const readAttachErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error);
};

export const isAttachBlockedError = (error: unknown): boolean => {
  const message = readAttachErrorMessage(error);
  return ATTACH_BLOCKED_ERROR_MARKERS.some((marker) => message.includes(marker));
};
