/* Thin by design: the handler's body lives in src/routes so the
   browser build can drop this folder from the static export while
   dispatch.ts keeps importing the module (design: mode 1). */
export { dynamic, GET } from "@/routes/analytics";
