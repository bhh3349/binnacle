/** 与后端 collect/types.go 一一对应（字段名与 JSON tag 必须保持一致）。 */

export interface MemStats {
  total: number;
  used: number;
  available: number;
  percent: number;
}

export interface CPUStats {
  cores: number;
  threads: number;
  model: string;
  usage: number;
  perCore: number[];
  mhz: number;
}

export interface DiskStats {
  device: string;
  mount: string;
  fstype: string;
  total: number;
  used: number;
  avail: number;
  percent: number;
  readBps: number;
  writeBps: number;
}

export interface NetStats {
  iface: string;
  rxBps: number;
  txBps: number;
}

export interface TempStat {
  label: string;
  celsius: number;
  /** omitempty：0 时后端不输出，此时不要画刻度线 */
  critical?: number;
  source: string;
}

export interface FanStat {
  label: string;
  rpm: number;
}

export interface HostStats {
  hostname: string;
  uptimeSec: number;
  load: [number, number, number] | number[];
  cpu: CPUStats;
  mem: MemStats;
  swap: MemStats;
  disks: DiskStats[];
  net: NetStats[];
  temps: TempStat[];
  fans: FanStat[];
}

export interface GPUMem {
  total: number;
  used: number;
  free: number;
  percent: number;
}

export interface GPUPower {
  draw: number;
  limit: number;
  default: number;
  min: number;
  max: number;
  percent: number;
}

export interface GPUClocks {
  sm: number;
  mem: number;
  maxSm: number;
  maxMem: number;
}

export interface GPUECC {
  mode: string;
  correctedVol: number;
  uncorrectedVol: number;
  correctedAgg: number;
  uncorrectedAgg: number;
  retiredSbe: number;
  retiredDbe: number;
}

export interface GPUPCIe {
  gen: number;
  genMax: number;
  width: number;
  widthMax: number;
  txBps: number;
  rxBps: number;
}

export interface GPUProc {
  pid: number;
  name: string;
  usedMem: number;
  user: string;
}

export interface GPUStats {
  index: number;
  name: string;
  uuid: string;
  vendor: string;
  driverVer: string;
  vbios: string;
  pciAddr: string;
  util: number;
  memUtil: number;
  encUtil: number | null;
  decUtil: number | null;
  mem: GPUMem;
  tempGpu: number;
  /** 3060 为 null —— 不渲染显存温度面板 */
  tempMem: number | null;
  tempLimit: number | null;
  power: GPUPower;
  clocks: GPUClocks;
  fan: number | null;
  /** false 时不要渲染风扇面板（V100 SXM2 被动散热） */
  fanSupported: boolean;
  /** 3060 为 null —— 不渲染 ECC 面板 */
  ecc: GPUECC | null;
  pcie: GPUPCIe;
  throttle: string[] | null;
  procs: GPUProc[] | null;
  pstate: number | null;
}

export interface Snapshot {
  t: number;
  host: HostStats;
  gpus: GPUStats[];
}

export interface Meta {
  root: string;
  sampleMs: number;
}

export interface HistoryResponse {
  from: number;
  to: number;
  step: number;
  points: Snapshot[];
  count: number;
}

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mode: string;
  mtime: string;
  symlink: boolean;
  linkTo?: string;
}

export interface FsListResponse {
  path: string;
  parent: string;
  total: number;
  free: number;
  totalSize: number;
  entries: FsEntry[];
}

export interface FsReadResponse {
  path: string;
  size: number;
  mtime: string;
  content: string;
}

export interface FsSearchResponse {
  hits: FsEntry[];
  count: number;
  truncated: boolean;
}

export interface FsStatResponse {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  /** 符号形式，如 -rw-r--r-- */
  mode: string;
  /** 八进制字符串，如 "0644" */
  modeOct: string;
  mtime: string;
  atime?: string;
  ctime?: string;
  /** 用户名（后端已解析，不是数字） */
  uid?: string;
  gid?: string;
  nlink?: number;
  inode?: number;
  /** 仅文件有，目录没有 */
  md5?: string;
}

export interface DuNode {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  count: number;
}

export interface DuResponse {
  path: string;
  depth: number;
  nodes: DuNode[];
}

export interface FsRoots {
  root: string;
  shortcuts: { name: string; path: string }[];
}

export type ServiceActive = 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating';

export interface ServiceEntry {
  name: string;
  description: string;
  active: ServiceActive | string;
  sub: string;
  loadState: string;
  sinceUnix: number;
  mainPid: number;
}

export interface ServicesResponse {
  count: number;
  services: ServiceEntry[];
}

export interface LogsResponse {
  unit: string;
  count: number;
  lines: string[] | null;
}

export interface ApiError {
  error: string;
}
