import { Switch as HeroSwitch } from "@heroui/react/switch";
export function Switch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (value: boolean) => void }) {
  return <HeroSwitch aria-label={label} isSelected={checked} isDisabled={disabled} onChange={onChange} className="aarre-switch">
    <HeroSwitch.Content><HeroSwitch.Control><HeroSwitch.Thumb /></HeroSwitch.Control></HeroSwitch.Content>
  </HeroSwitch>;
}
