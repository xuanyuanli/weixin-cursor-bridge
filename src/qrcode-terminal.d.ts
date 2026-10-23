declare module "qrcode-terminal" {
  function generate(input: string, options?: { small?: boolean }): void;
  export default { generate };
}
