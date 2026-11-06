package collect

import (
	"encoding/binary"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/NVIDIA/go-nvml/pkg/nvml"
)

// GPUCollector 直连 NVML，不 fork nvidia-smi。
type GPUCollector struct {
	mu       sync.Mutex
	inited   bool
	err      error
	count    int
	meta     []gpuMeta
	procName map[int]string // pid -> comm 缓存（TTL 内复用）
}

type gpuMeta struct {
	Name    string
	UUID    string
	VBIOS   string
	PCIAddr string
	Driver  string
}

var gpuCollector = &GPUCollector{procName: map[int]string{}}

func NewGPUCollector() *GPUCollector { return gpuCollector }

func (g *GPUCollector) init() bool {
	if g.inited {
		return g.err == nil
	}
	g.inited = true
	if ret := nvml.Init(); ret != nvml.SUCCESS {
		g.err = fmt.Errorf("nvml.Init: %v", nvml.ErrorString(ret))
		return false
	}
	n, ret := nvml.DeviceGetCount()
	if ret != nvml.SUCCESS {
		g.err = fmt.Errorf("DeviceGetCount: %v", nvml.ErrorString(ret))
		return false
	}
	g.count = n
	drv, _ := nvml.SystemGetDriverVersion()
	for i := 0; i < n; i++ {
		var m gpuMeta
		m.Driver = drv
		if d, ret := nvml.DeviceGetHandleByIndex(i); ret == nvml.SUCCESS {
			if s, r := nvml.DeviceGetName(d); r == nvml.SUCCESS {
				m.Name = s
			}
			if s, r := nvml.DeviceGetUUID(d); r == nvml.SUCCESS {
				m.UUID = s
			}
			if s, r := nvml.DeviceGetVbiosVersion(d); r == nvml.SUCCESS {
				m.VBIOS = s
			}
			if s, r := nvml.DeviceGetPciInfo(d); r == nvml.SUCCESS {
				m.PCIAddr = cstr(s.BusId[:])
			}
		}
		g.meta = append(g.meta, m)
	}
	return true
}

// Collect 返回所有卡的实时状态。任何单卡失败不影响其它卡。
func (g *GPUCollector) Collect() []GPUStats {
	g.mu.Lock()
	defer g.mu.Unlock()

	if !g.init() {
		return nil
	}
	out := make([]GPUStats, 0, g.count)
	for i := 0; i < g.count; i++ {
		d, ret := nvml.DeviceGetHandleByIndex(i)
		if ret != nvml.SUCCESS {
			continue
		}
		out = append(out, g.collectOne(i, d))
	}
	return out
}

func (g *GPUCollector) collectOne(idx int, d nvml.Device) GPUStats {
	var s GPUStats
	s.Index = idx
	s.Vendor = "nvidia"
	if idx < len(g.meta) {
		s.Name = g.meta[idx].Name
		s.UUID = g.meta[idx].UUID
		s.VBIOS = g.meta[idx].VBIOS
		s.PCIAddr = g.meta[idx].PCIAddr
		s.DriverVer = g.meta[idx].Driver
	}

	if u, ret := nvml.DeviceGetUtilizationRates(d); ret == nvml.SUCCESS {
		s.Util = float64(u.Gpu)
		s.MemUtil = float64(u.Memory)
	}
	// 编解码器利用率：只有部分卡支持
	if u, _, ret := nvml.DeviceGetEncoderUtilization(d); ret == nvml.SUCCESS {
		v := float64(u)
		s.EncUtil = &v
	}
	if u, _, ret := nvml.DeviceGetDecoderUtilization(d); ret == nvml.SUCCESS {
		v := float64(u)
		s.DecUtil = &v
	}

	if m, ret := nvml.DeviceGetMemoryInfo(d); ret == nvml.SUCCESS {
		s.Mem = GPUMem{Total: m.Total, Used: m.Used, Free: m.Free}
		if m.Total > 0 {
			s.Mem.Percent = float64(m.Used) / float64(m.Total) * 100
		}
	}

	if t, ret := nvml.DeviceGetTemperature(d, nvml.TEMPERATURE_GPU); ret == nvml.SUCCESS {
		s.TempGPU = float64(t)
	}
	// 显存温度走 FieldValues：3060 不支持，V100 支持
	if v, ok := fieldValueInt(d, nvml.FI_DEV_MEMORY_TEMP); ok && v > 0 {
		f := float64(v)
		s.TempMem = &f
	}
	// 温度墙
	if v, ok := fieldValueInt(d, nvml.FI_DEV_TEMPERATURE_SLOWDOWN_TLIMIT); ok && v > 0 {
		f := float64(v)
		s.TempLimit = &f
	}

	if p, ret := nvml.DeviceGetPowerUsage(d); ret == nvml.SUCCESS {
		s.Power.Draw = float64(p) / 1000
	}
	if p, ret := nvml.DeviceGetPowerManagementLimit(d); ret == nvml.SUCCESS {
		s.Power.Limit = float64(p) / 1000
	}
	if p, ret := nvml.DeviceGetPowerManagementDefaultLimit(d); ret == nvml.SUCCESS {
		s.Power.Default = float64(p) / 1000
	}
	if lo, hi, ret := nvml.DeviceGetPowerManagementLimitConstraints(d); ret == nvml.SUCCESS {
		s.Power.Min = float64(lo) / 1000
		s.Power.Max = float64(hi) / 1000
	}
	if s.Power.Limit > 0 {
		s.Power.Percent = s.Power.Draw / s.Power.Limit * 100
	}

	if c, ret := nvml.DeviceGetClockInfo(d, nvml.CLOCK_SM); ret == nvml.SUCCESS {
		s.Clocks.SM = int(c)
	}
	if c, ret := nvml.DeviceGetClockInfo(d, nvml.CLOCK_MEM); ret == nvml.SUCCESS {
		s.Clocks.Mem = int(c)
	}
	if c, ret := nvml.DeviceGetMaxClockInfo(d, nvml.CLOCK_SM); ret == nvml.SUCCESS {
		s.Clocks.MaxSM = int(c)
	}
	if c, ret := nvml.DeviceGetMaxClockInfo(d, nvml.CLOCK_MEM); ret == nvml.SUCCESS {
		s.Clocks.MaxMem = int(c)
	}

	// 风扇：V100 SXM2 无风扇，必须标记为不支持而不是 0
	if f, ret := nvml.DeviceGetFanSpeed(d); ret == nvml.SUCCESS {
		// 进一步确认：fanSpeed 为 0 且无风扇的卡会返回 SUCCESS，需交叉验证
		if !isFanless(s.Name) {
			v := float64(f)
			s.Fan = &v
			s.FanSupported = true
		}
	}

	// ECC：消费卡 Not Supported
	if cur, _, ret := nvml.DeviceGetEccMode(d); ret == nvml.SUCCESS {
		e := &GPUECC{Mode: eccModeString(cur)}
		if v, r := nvml.DeviceGetTotalEccErrors(d, nvml.MEMORY_ERROR_TYPE_CORRECTED, nvml.VOLATILE_ECC); r == nvml.SUCCESS {
			e.CorrectedVol = v
		}
		if v, r := nvml.DeviceGetTotalEccErrors(d, nvml.MEMORY_ERROR_TYPE_UNCORRECTED, nvml.VOLATILE_ECC); r == nvml.SUCCESS {
			e.UncorrectedVol = v
		}
		if v, r := nvml.DeviceGetTotalEccErrors(d, nvml.MEMORY_ERROR_TYPE_CORRECTED, nvml.AGGREGATE_ECC); r == nvml.SUCCESS {
			e.CorrectedAgg = v
		}
		if v, r := nvml.DeviceGetTotalEccErrors(d, nvml.MEMORY_ERROR_TYPE_UNCORRECTED, nvml.AGGREGATE_ECC); r == nvml.SUCCESS {
			e.UncorrectedAgg = v
		}
		if v, r := nvml.DeviceGetRetiredPagesPendingStatus(d); r == nvml.SUCCESS {
			_ = v
		}
		if pages, r := nvml.DeviceGetRetiredPages(d, nvml.PAGE_RETIREMENT_CAUSE_MULTIPLE_SINGLE_BIT_ECC_ERRORS); r == nvml.SUCCESS {
			e.RetiredSBE = uint64(len(pages))
		}
		if pages, r := nvml.DeviceGetRetiredPages(d, nvml.PAGE_RETIREMENT_CAUSE_DOUBLE_BIT_ECC_ERROR); r == nvml.SUCCESS {
			e.RetiredDBE = uint64(len(pages))
		}
		s.ECC = e
	}

	if gen, ret := nvml.DeviceGetCurrPcieLinkGeneration(d); ret == nvml.SUCCESS {
		s.PCIe.Gen = int(gen)
	}
	if gen, ret := nvml.DeviceGetMaxPcieLinkGeneration(d); ret == nvml.SUCCESS {
		s.PCIe.GenMax = int(gen)
	}
	if w, ret := nvml.DeviceGetCurrPcieLinkWidth(d); ret == nvml.SUCCESS {
		s.PCIe.Width = int(w)
	}
	if w, ret := nvml.DeviceGetMaxPcieLinkWidth(d); ret == nvml.SUCCESS {
		s.PCIe.WidthMax = int(w)
	}
	// NVML 返回 KB/s
	if t, ret := nvml.DeviceGetPcieThroughput(d, nvml.PCIE_UTIL_TX_BYTES); ret == nvml.SUCCESS {
		s.PCIe.TxBps = float64(t) * 1024
	}
	if r, ret := nvml.DeviceGetPcieThroughput(d, nvml.PCIE_UTIL_RX_BYTES); ret == nvml.SUCCESS {
		s.PCIe.RxBps = float64(r) * 1024
	}

	if th, ret := nvml.DeviceGetCurrentClocksThrottleReasons(d); ret == nvml.SUCCESS {
		s.Throttle = decodeThrottle(th)
	}

	if ps, ret := nvml.DeviceGetPerformanceState(d); ret == nvml.SUCCESS {
		v := int(ps)
		s.PState = &v
	}

	if procs, ret := nvml.DeviceGetComputeRunningProcesses(d); ret == nvml.SUCCESS {
		s.Procs = g.enrichProcs(procs)
	}
	return s
}

// enrichProcs 补进程名与属主：NVML 只给 pid 和显存占用。
func (g *GPUCollector) enrichProcs(procs []nvml.ProcessInfo) []GPUProc {
	out := make([]GPUProc, 0, len(procs))
	for _, p := range procs {
		pid := int(p.Pid)
		gp := GPUProc{PID: pid, UsedMem: p.UsedGpuMemory}
		if name, ok := g.procName[pid]; ok {
			gp.Name = name
		} else {
			gp.Name = readComm(pid)
			g.procName[pid] = gp.Name
		}
		gp.User = readOwner(pid)
		out = append(out, gp)
	}
	// 清理已退出的 pid，避免 map 无限增长
	if len(g.procName) > 512 {
		g.procName = map[int]string{}
	}
	return out
}

// cstr 把 NVML 的 [32]int8 定长数组转成 Go 字符串。
func cstr(b []int8) string {
	buf := make([]byte, 0, len(b))
	for _, c := range b {
		if c == 0 {
			break
		}
		buf = append(buf, byte(c))
	}
	return string(buf)
}

func readComm(pid int) string {
	b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/comm")
	if err != nil {
		return "?"
	}
	return strings.TrimSpace(string(b))
}

func readOwner(pid int) string {
	st, err := os.Stat("/proc/" + strconv.Itoa(pid))
	if err != nil {
		return "?"
	}
	if uid, ok := uidOf(st); ok {
		return uid
	}
	return "?"
}

func fieldValueInt(d nvml.Device, id uint32) (int, bool) {
	fv := []nvml.FieldValue{{FieldId: id}}
	if ret := d.GetFieldValues(fv); ret != nvml.SUCCESS {
		return 0, false
	}
	if fv[0].NvmlReturn != 0 {
		return 0, false
	}
	return int(binary.LittleEndian.Uint64(fv[0].Value[:])), true
}

func eccModeString(m nvml.EnableState) string {
	switch m {
	case nvml.FEATURE_ENABLED:
		return "enabled"
	case nvml.FEATURE_DISABLED:
		return "disabled"
	}
	return "unknown"
}

// isFanless 处理「有风扇接口但实际无风扇」的卡：SXM2 规格为被动散热。
func isFanless(name string) bool {
	up := strings.ToUpper(name)
	for _, k := range []string{"SXM2", "SXM3", "SXM4", "SXM5", "TESLA V100-SXM", "A100-SXM", "H100-SXM"} {
		if strings.Contains(up, k) {
			return true
		}
	}
	return false
}

// decodeThrottle 把位掩码翻成人话，语义借鉴 homelab-monitor 的解码表。
func decodeThrottle(bits uint64) []string {
	table := []struct {
		bit  uint64
		name string
	}{
		{0x1, "gpu_idle"},
		{0x2, "applications_clocks_setting"},
		{0x4, "sw_power_cap"},
		{0x8, "hw_slowdown"},
		{0x10, "sync_boost"},
		{0x20, "sw_thermal_slowdown"},
		{0x40, "hw_thermal_slowdown"},
		{0x80, "hw_power_brake_slowdown"},
		{0x100, "display_clock_setting"},
	}
	out := []string{}
	for _, e := range table {
		if bits&e.bit != 0 {
			out = append(out, e.name)
		}
	}
	return out
}
