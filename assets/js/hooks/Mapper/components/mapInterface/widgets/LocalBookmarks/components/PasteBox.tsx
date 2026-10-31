import { ClipboardEvent, useState } from 'react';

type PasteBoxProps = {
  initialValue: string;
  hasExisting: boolean;
  onSave: (text: string) => void;
  onCancel?: () => void;
};

export const PasteBox = ({ initialValue, hasExisting, onSave, onCancel }: PasteBoxProps) => {
  const [draft, setDraft] = useState(initialValue);

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!pasted.trim()) {
      return;
    }

    // A pasted list replaces the previous one for this system.
    event.preventDefault();
    setDraft(pasted);
    onSave(pasted);
  };

  const handleSave = () => {
    if (draft.trim()) {
      onSave(draft);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="shrink-0 text-[11px] leading-relaxed text-stone-400">
        从游戏内「人物与地点」复制位标，然后粘贴到下面。每行：名称 / 文件夹 / 可选时间。
        <br />
        对比只解析名称，不使用文件夹名。
      </div>

      <textarea
        className="custom-scrollbar min-h-0 flex-1 resize-none rounded border border-stone-700 bg-stone-900/80 p-2 font-mono text-[11px] leading-relaxed text-stone-200 outline-none focus:border-stone-500"
        placeholder={'HZM 5-k4c\t黑海岸5-5 / .虫洞口\t-\nXCR-433 5-5\t黑海岸5-5 / .虫洞口\t2026.10.31 15:35'}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onPaste={handlePaste}
        spellCheck={false}
      />

      <div className="flex shrink-0 items-center justify-end gap-2 text-[11px]">
        {hasExisting && onCancel && (
          <button type="button" className="text-stone-400 hover:text-stone-100" onClick={onCancel}>
            取消
          </button>
        )}
        <button
          type="button"
          className="rounded border border-stone-700 px-2 py-0.5 text-stone-300 hover:border-stone-500 hover:text-white disabled:opacity-40"
          disabled={!draft.trim()}
          onClick={handleSave}
        >
          保存并对比
        </button>
      </div>
    </div>
  );
};
