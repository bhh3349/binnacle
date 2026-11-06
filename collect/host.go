package collect

import (
	"bufio"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
)

// HostCollector 采集 CPU/内存/磁盘/网络/传感器，所有速率靠两次采样差分。
type HostCollector struct {
	mu      sync.Mutex
	lastAt  time.Time
	lastDsk map[string][2]uint64 // device -> {readBytes, writeBytes}
	lastNet map[string][2]uint64 // iface  -> {rxBytes, txBytes}
	cpuStat cpu.TimesStat
}

func NewHostCollector() *HostCollector {
	return &HostCollector{
		lastDsk: map[string][2]uint64{},
		lastNet: map[string][2]uint64{},
	}
}

var excludedFSTypes = map[string]bool{
	"tmpfs": true, "devtmpfs": true, "squashfs": true, "overlay": true,
	"proc": true, "sysfs": true, "cgroup": true, "cgroup2": true,
	"devpts": true, "mqueue": true, "hugetlbfs": true, "debugfs": true,
	"tracefs": true, "securityfs": true, "pstore": true, "bpf": true,
	"autofs": true, "binfmt_misc": true, "configfs": true, "fusectl": true,
	"efivarfs": true, "ramfs": true,
}

var skipDevices = map[string]bool{
	"loop0": true, "loop1": true, "loop2": true, "loop3": true, "loop4": true,
	"loop5": true, "loop6": true, "loop7": true,
}

func (h *HostCollector) Collect() HostStats {
	h.mu.Lock()
	defer h.mu.Unlock()

	now := time.Now()
	elapsed := 1.0
	if !h.lastAt.IsZero() {
		elapsed = now.Sub(h.lastAt).Seconds()
		if elapsed <= 0 {
			elapsed = 1
		}
	}
	h.lastAt = now

	var s HostStats

	if hi, err := host.Info(); err == nil {
		s.Hostname = hi.Hostname
		s.UptimeSec = int64(hi.Uptime)
	}
	if s.Hostname == "" {
		s.Hostname, _ = os.Hostname()
	}

	if la, err := load.Avg(); err == nil {
		s.Load = [3]float64{la.Load1, la.Load5, la.Load15}
	}

	/* ---------- CPU ---------- */
	if infos, err := cpu.Info(); err == nil && len(infos) > 0 {
		s.CPU.Model = strings.TrimSpace(infos[0].ModelName)
		s.CPU.MHz = infos[0].Mhz
	}
	// gopsutil 的 Info().Cores 在 Linux 上取的是单 socket 的物理核数，
	// 且多 socket / 超线程场景会算错。用 topology/core_id 去重更可靠。
	s.CPU.Cores = countPhysicalCores()
	if pct, err := cpu.Percent(0, false); err == nil && len(pct) > 0 {
		s.CPU.Usage = round1(pct[0])
	}
	if per, err := cpu.Percent(0, true); err == nil {
		s.CPU.PerCore = make([]float64, len(per))
		for i, v := range per {
			s.CPU.PerCore[i] = round1(v)
		}
		s.CPU.Threads = len(per)
	}
	if s.CPU.Cores == 0 {
		s.CPU.Cores = s.CPU.Threads
	}

	/* ---------- 内存：用 /proc/meminfo 的 MemAvailable，gopsutil 的 Used 含 cache 会虚高 ---------- */
	if vm, err := mem.VirtualMemory(); err == nil {
		s.Mem.Total = vm.Total
		s.Mem.Available = vm.Available
		s.Mem.Used = vm.Total - vm.Available
		if vm.Total > 0 {
			s.Mem.Percent = round1(float64(s.Mem.Used) / float64(vm.Total) * 100)
		}
	}
	if sw, err := mem.SwapMemory(); err == nil && sw.Total > 0 {
		s.Swap.Total = sw.Total
		s.Swap.Used = sw.Used
		s.Swap.Available = sw.Total - sw.Used
		s.Swap.Percent = round1(sw.UsedPercent)
	}

	/* ---------- 磁盘容量 ---------- */
	parts, _ := disk.Partitions(false)
	seen := map[string]bool{}
	for _, p := range parts {
		if excludedFSTypes[p.Fstype] {
			continue
		}
		if strings.HasPrefix(p.Mountpoint, "/sys") || strings.HasPrefix(p.Mountpoint, "/proc") {
			continue
		}
		u, err := disk.Usage(p.Mountpoint)
		if err != nil || u.Total == 0 {
			continue
		}
		key := p.Device + p.Mountpoint
		if seen[key] {
			continue
		}
		seen[key] = true
		s.Disks = append(s.Disks, DiskStats{
			Device:  p.Device,
			Mount:   p.Mountpoint,
			FSType:  p.Fstype,
			Total:   u.Total,
			Used:    u.Used,
			Avail:   u.Free,
			Percent: round1(u.UsedPercent),
		})
	}
	sort.Slice(s.Disks, func(i, j int) bool { return s.Disks[i].Mount < s.Disks[j].Mount })

	/* ---------- 磁盘 IO 速率 ---------- */
	if ioMap, err := disk.IOCounters(); err == nil {
		for dev, io := range ioMap {
			if skipDevices[dev] {
				continue
			}
			cur := [2]uint64{io.ReadBytes, io.WriteBytes}
			if prev, ok := h.lastDsk[dev]; ok && !h.lastAt.IsZero() {
				rb := float64(cur[0]-prev[0]) / elapsed
				wb := float64(cur[1]-prev[1]) / elapsed
				for i := range s.Disks {
					if strings.Contains(s.Disks[i].Device, dev) || strings.Contains(dev, strings.TrimPrefix(s.Disks[i].Device, "/dev/")) {
						s.Disks[i].ReadBps = rb
						s.Disks[i].WriteBps = wb
					}
				}
			}
			h.lastDsk[dev] = cur
		}
	}

	/* ---------- 网络速率 ---------- */
	if nets, err := readNetDev(); err == nil {
		for iface, cur := range nets {
			if iface == "lo" || strings.HasPrefix(iface, "docker") || strings.HasPrefix(iface, "veth") || strings.HasPrefix(iface, "br-") {
				continue
			}
			var rx, tx float64
			if prev, ok := h.lastNet[iface]; ok {
				rx = float64(cur[0]-prev[0]) / elapsed
				tx = float64(cur[1]-prev[1]) / elapsed
			}
			h.lastNet[iface] = cur
			s.Net = append(s.Net, NetStats{Iface: iface, RxBps: rx, TxBps: tx})
		}
		sort.Slice(s.Net, func(i, j int) bool { return s.Net[i].Iface < s.Net[j].Iface })
	}

	/* ---------- 传感器 ---------- */
	s.Temps, s.Fans = readSensors()

	return s
}

// readNetDev 直接读 /proc/net/dev，比 gopsutil 少一次分配。
func readNetDev() (map[string][2]uint64, error) {
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return nil, err
	}
	defer f.Close()

	out := map[string][2]uint64{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		i := strings.Index(line, ":")
		if i < 0 {
			continue
		}
		name := strings.TrimSpace(line[:i])
		fields := strings.Fields(line[i+1:])
		if len(fields) < 9 {
			continue
		}
		rx, _ := strconv.ParseUint(fields[0], 10, 64)
		tx, _ := strconv.ParseUint(fields[8], 10, 64)
		out[name] = [2]uint64{rx, tx}
	}
	return out, nil
}

/* ------------------------------------------------------------------
 * 传感器
 *
 * 踩坑记录（X99 + nct6779 + coretemp）：
 *  1. nct6779 的 AUXTIN1/2/3 未接热敏电阻时读 112-114°C，必须按值过滤；
 *     这类悬空通道的判据是「读数 > 100 且 label 以 AUXTIN 开头」。
 *  2. Vcore / in6 / in9 / in10-in14 的 ALARM 是 X99 已知误报，不采电压。
 *  3. coretemp 报 11 个：Package + 10 核，与 E5-2666 v3 的 10C/20T 一致。
 *  4. 风扇通道 5 个里只有 fan2 接了（冷排/水泵），其余 0 RPM 不展示。
 * ------------------------------------------------------------------ */

func readSensors() ([]TempStat, []FanStat) {
	var temps []TempStat
	var fans []FanStat

	dirs, _ := filepath.Glob("/sys/class/hwmon/hwmon*")
	sort.Strings(dirs)

	for _, d := range dirs {
		nameB, err := os.ReadFile(filepath.Join(d, "name"))
		if err != nil {
			continue
		}
		chip := strings.TrimSpace(string(nameB))

		inputs, _ := filepath.Glob(filepath.Join(d, "temp*_input"))
		sort.Slice(inputs, func(i, j int) bool { return numSuffix(inputs[i]) < numSuffix(inputs[j]) })

		for _, in := range inputs {
			base := strings.TrimSuffix(in, "_input")
			raw, err := os.ReadFile(in)
			if err != nil {
				continue
			}
			milli, err := strconv.Atoi(strings.TrimSpace(string(raw)))
			if err != nil || milli == 0 {
				continue
			}
			label := chip + ":" + filepath.Base(base)
			if lb, err := os.ReadFile(base + "_label"); err == nil {
				label = strings.TrimSpace(string(lb))
			}
			cel := float64(milli) / 1000

			// 过滤悬空通道
			if isDanglingTemp(chip, label, cel) {
				continue
			}

			var crit float64
			if cb, err := os.ReadFile(base + "_crit"); err == nil {
				if v, err := strconv.Atoi(strings.TrimSpace(string(cb))); err == nil && v > 0 {
					crit = float64(v) / 1000
				}
			}
			temps = append(temps, TempStat{
				Label:    label,
				Celsius:  round1(cel),
				Critical: round1(crit),
				Source:   chip,
			})
		}

		// 风扇：只保留有实际转速的通道
		fansIn, _ := filepath.Glob(filepath.Join(d, "fan*_input"))
		sort.Slice(fansIn, func(i, j int) bool { return numSuffix(fansIn[i]) < numSuffix(fansIn[j]) })
		for _, in := range fansIn {
			raw, err := os.ReadFile(in)
			if err != nil {
				continue
			}
			rpm, err := strconv.Atoi(strings.TrimSpace(string(raw)))
			if err != nil || rpm <= 0 {
				continue
			}
			label := chip + ":" + strings.TrimSuffix(filepath.Base(in), "_input")
			if lb, err := os.ReadFile(strings.TrimSuffix(in, "_input") + "_label"); err == nil {
				if s := strings.TrimSpace(string(lb)); s != "" {
					label = s
				}
			}
			fans = append(fans, FanStat{Label: label, RPM: rpm})
		}
	}

	// 排序：Package / CPU 优先，其次按温度降序
	sort.SliceStable(temps, func(i, j int) bool {
		pi, pj := tempPriority(temps[i]), tempPriority(temps[j])
		if pi != pj {
			return pi < pj
		}
		return temps[i].Celsius > temps[j].Celsius
	})
	return temps, fans
}

// isDanglingTemp 识别未接热敏电阻的悬空通道。
func isDanglingTemp(chip, label string, c float64) bool {
	// nct6779 的 AUXTIN 系列：接了是室温量级，没接会读到 110+ 的固定值
	if strings.Contains(strings.ToUpper(label), "AUXTIN") && c > 100 {
		return true
	}
	// 任何芯片读到 -50 以下或 150 以上，都是无效值
	if c < -50 || c > 150 {
		return true
	}
	// PCH 系列在多数 X99 板上不返回有效值（恒 0，已在上面被 milli==0 过滤）
	return false
}

func tempPriority(t TempStat) int {
	l := strings.ToLower(t.Label)
	switch {
	case strings.Contains(l, "package"):
		return 0
	case strings.Contains(l, "core "):
		return 1
	case strings.Contains(l, "composite"):
		return 2
	case strings.Contains(l, "cputin"), strings.Contains(l, "peci"):
		return 3
	case strings.Contains(l, "systin"):
		return 4
	default:
		return 5
	}
}

// countPhysicalCores 用 sysfs topology 统计物理核数（socket_id + core_id 去重）。
func countPhysicalCores() int {
	cpus, _ := filepath.Glob("/sys/devices/system/cpu/cpu[0-9]*/topology/core_id")
	type key struct{ pkg, core string }
	seen := map[key]bool{}
	for _, p := range cpus {
		coreB, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		pkgB, err := os.ReadFile(filepath.Join(filepath.Dir(p), "physical_package_id"))
		if err != nil {
			continue
		}
		seen[key{
			pkg:  strings.TrimSpace(string(pkgB)),
			core: strings.TrimSpace(string(coreB)),
		}] = true
	}
	if len(seen) == 0 {
		return 0
	}
	return len(seen)
}

func numSuffix(p string) int {
	i := strings.LastIndexAny(p, "0123456789")
	if i < 0 {
		return 0
	}
	j := i
	for j > 0 && p[j-1] >= '0' && p[j-1] <= '9' {
		j--
	}
	n, _ := strconv.Atoi(p[j : i+1])
	return n
}

func round1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}
