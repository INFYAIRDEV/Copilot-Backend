import i18n, { type InitOptions } from "i18next";
import Backend from "i18next-fs-backend";
import path from "path";

let initialized = false;

const options: InitOptions = {
  fallbackLng: "en",
  debug: false,
  load: "languageOnly",
  preload: ["en", "it", "fr"],
  supportedLngs: ["en", "it", "fr"],
  ns: ["common", "entity"],
  defaultNS: "common",
  backend: {
    loadPath: path.resolve(
      process.cwd(),
      "src/shared/translation/locales/{{lng}}/{{ns}}.json",
    ),
  },
  returnNull: false,
  returnEmptyString: false,
  interpolation: {
    escapeValue: false,
  },
};

await i18n.use(Backend).init(options);

export function getTranslator(lang?: string) {
  const lng = lang || "en";
  return i18n.getFixedT(lng, ["common", "entity", "zod"]);
}

export default i18n;
