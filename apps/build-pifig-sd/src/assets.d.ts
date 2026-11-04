/** Bundle files imported `with { type: "file" }`: each import is the file's path. */
declare module "*.tar.gz" {
  const path: string;
  export default path;
}
declare module "*.sh" {
  const path: string;
  export default path;
}
declare module "*.service" {
  const path: string;
  export default path;
}
declare module "*.conf" {
  const path: string;
  export default path;
}
declare module "*/python-version" {
  const path: string;
  export default path;
}
declare module "*/config-template" {
  const path: string;
  export default path;
}
