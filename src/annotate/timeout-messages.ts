export const ANNOTATION_TIMEOUT_MESSAGE = "Annotation request timed out.";
export const ANNOTATION_MANUAL_COMPLETION_TIMEOUT_MESSAGE =
  "Annotation UI started and is waiting for manual completion.";

export const getAnnotationTimeoutMessage = (readySeen: boolean): string => {
  return readySeen ? ANNOTATION_MANUAL_COMPLETION_TIMEOUT_MESSAGE : ANNOTATION_TIMEOUT_MESSAGE;
};
