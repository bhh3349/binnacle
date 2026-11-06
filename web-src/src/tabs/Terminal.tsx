import { MultiTerminal } from '../components/MultiTerminal';

/** 独立「终端」页签：全宽多终端，组件与文件页右侧复用同一个。 */
export function TerminalTab({ active }: { active: boolean }) {
  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[420px] flex-col">
      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <MultiTerminal className="min-h-0 flex-1" active={active} />
      </div>
    </div>
  );
}
