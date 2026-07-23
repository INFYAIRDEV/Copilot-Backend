import { AsyncLocalStorage } from "async_hooks";

interface RequestContextData {
  lang?: string;
}

const contextStorage = new AsyncLocalStorage<RequestContextData>();

export const setRequestContext = (
  context: RequestContextData,
  callback: () => void,
) => {
  contextStorage.run(context, callback);
};

export const getRequestContext = (): RequestContextData | undefined => {
  return contextStorage.getStore();
};

export const getLang = (): string => {
  return contextStorage.getStore()?.lang || "en";
};
