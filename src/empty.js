export const createRequire = () => () => ({});
export const statSync = () => ({});
export const createReadStream = () => ({});
export const existsSync = () => false;
export const promises = {
  readFile: async () => '',
  writeFile: async () => {},
  mkdir: async () => {},
};

export const platform = () => 'browser';
export const homedir = () => '/';
export const EOL = '\n';
export const isIP = () => false;
export const spawn = () => ({});
export const exec = () => ({});
export const execSync = () => '';

export class IncomingMessage {}
export class ServerResponse {}

export default {
  createRequire,
  statSync,
  createReadStream,
  existsSync,
  promises,
  platform,
  homedir,
  EOL,
  isIP,
  spawn,
  exec,
  execSync,
  IncomingMessage,
  ServerResponse,
};
