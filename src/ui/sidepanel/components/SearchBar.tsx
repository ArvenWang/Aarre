import { Button } from "@/ui/components/ui/button";
import { FluidInput } from "@/ui/components/ui/input";
import { CloseIcon, SearchIcon } from "../../components/Icons";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
}

export function SearchBar({
  value,
  onChange,
  onClear,
  onSubmit,
}: SearchBarProps) {
  return (
    <form
      className="search-box"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSubmit();
      }}
    >
      <SearchIcon aria-hidden="true" />
      <FluidInput
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onClear();
          }
        }}
        placeholder="搜索标题、标签、摘要或拼音"
        aria-label="搜索 Chrome 书签"
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="清空搜索"
          title="清空搜索"
          onClick={onClear}
        >
          <CloseIcon />
        </Button>
      ) : null}
    </form>
  );
}
