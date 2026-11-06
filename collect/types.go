package collect

// Snapshot 是一次完整采样的结果，WS 每秒推一份。
type Snapshot struct {
	T    int64      `json:"t"`
	Host HostStats  `json:"host"`
	GPUs []GPUStats `json:"gpus"`
}

type HostStats struct {
	Hostname  string      `json:"hostname"`
	UptimeSec int64       `json:"uptimeSec"`
	Load      [3]float64  `json:"load"`
	CPU       CPUStats    `json:"cpu"`
	Mem       MemStats    `json:"mem"`
	Swap      MemStats    `json:"swap"`
	Disks     []DiskStats `json:"disks"`
	Net       []NetStats  `json:"net"`
	Temps     []TempStat  `json:"temps"`
	Fans      []FanStat   `json:"fans"`
}

type CPUStats struct {
	Cores   int       `json:"cores"`
	Threads int       `json:"threads"`
	Model   string    `json:"model"`
	Usage   float64   `json:"usage"`
	PerCore []float64 `json:"perCore"`
	MHz     float64   `json:"mhz"`
}

type MemStats struct {
	Total     uint64  `json:"total"`
	Used      uint64  `json:"used"`
	Available uint64  `json:"available"`
	Percent   float64 `json:"percent"`
}

type DiskStats struct {
	Device   string  `json:"device"`
	Mount    string  `json:"mount"`
	FSType   string  `json:"fstype"`
	Total    uint64  `json:"total"`
	Used     uint64  `json:"used"`
	Avail    uint64  `json:"avail"`
	Percent  float64 `json:"percent"`
	ReadBps  float64 `json:"readBps"`
	WriteBps float64 `json:"writeBps"`
}

type NetStats struct {
	Iface string  `json:"iface"`
	RxBps float64 `json:"rxBps"`
	TxBps float64 `json:"txBps"`
}

type TempStat struct {
	Label    string  `json:"label"`
	Celsius  float64 `json:"celsius"`
	Critical float64 `json:"critical,omitempty"`
	Source   string  `json:"source"`
}

type FanStat struct {
	Label string `json:"label"`
	RPM   int    `json:"rpm"`
}

// GPUStats 按卡区分，不支持的能力用指针 nil 表示，前端不渲染该面板。
type GPUStats struct {
	Index        int          `json:"index"`
	Name         string       `json:"name"`
	UUID         string       `json:"uuid"`
	Vendor       string       `json:"vendor"`
	DriverVer    string       `json:"driverVer"`
	VBIOS        string       `json:"vbios"`
	PCIAddr      string       `json:"pciAddr"`
	Util         float64      `json:"util"`
	MemUtil      float64      `json:"memUtil"`
	EncUtil      *float64     `json:"encUtil"`
	DecUtil      *float64     `json:"decUtil"`
	Mem          GPUMem       `json:"mem"`
	TempGPU      float64      `json:"tempGpu"`
	TempMem      *float64     `json:"tempMem"`
	TempLimit    *float64     `json:"tempLimit"`
	Power        GPUPower     `json:"power"`
	Clocks       GPUClocks    `json:"clocks"`
	Fan          *float64     `json:"fan"`
	FanSupported bool         `json:"fanSupported"`
	ECC          *GPUECC      `json:"ecc"`
	PCIe         GPUPCIe      `json:"pcie"`
	Throttle     []string     `json:"throttle"`
	Procs        []GPUProc    `json:"procs"`
	PState       *int         `json:"pstate"`
}

type GPUMem struct {
	Total   uint64  `json:"total"`
	Used    uint64  `json:"used"`
	Free    uint64  `json:"free"`
	Percent float64 `json:"percent"`
}

type GPUPower struct {
	Draw    float64 `json:"draw"`
	Limit   float64 `json:"limit"`
	Default float64 `json:"default"`
	Min     float64 `json:"min"`
	Max     float64 `json:"max"`
	Percent float64 `json:"percent"`
}

type GPUClocks struct {
	SM    int `json:"sm"`
	Mem   int `json:"mem"`
	MaxSM int `json:"maxSm"`
	MaxMem int `json:"maxMem"`
}

type GPUECC struct {
	Mode           string `json:"mode"`
	CorrectedVol   uint64 `json:"correctedVol"`
	UncorrectedVol uint64 `json:"uncorrectedVol"`
	CorrectedAgg   uint64 `json:"correctedAgg"`
	UncorrectedAgg uint64 `json:"uncorrectedAgg"`
	RetiredSBE     uint64 `json:"retiredSbe"`
	RetiredDBE     uint64 `json:"retiredDbe"`
}

type GPUPCIe struct {
	Gen      int     `json:"gen"`
	GenMax   int     `json:"genMax"`
	Width    int     `json:"width"`
	WidthMax int     `json:"widthMax"`
	TxBps    float64 `json:"txBps"`
	RxBps    float64 `json:"rxBps"`
}

type GPUProc struct {
	PID     int    `json:"pid"`
	Name    string `json:"name"`
	UsedMem uint64 `json:"usedMem"`
	User    string `json:"user"`
}
