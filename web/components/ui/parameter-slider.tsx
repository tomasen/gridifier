import { Input } from "./input"
import { Slider } from "./slider"

interface ParameterSliderProps {
    label: string
    value: number | undefined
    onChange: (value: number) => void
    min?: number
    max?: number
    step?: number
    className?: string
    explanation?: string
}

export function ParameterSlider({
    label,
    value,
    onChange,
    min = 1,
    max = 20,
    step = 1,
    className,
    explanation
}: ParameterSliderProps) {
    return (
        <div className={className}>
            <div className="flex justify-between items-center">
                <label className="text-sm font-medium">{label}</label>
                <Input
                    type="number"
                    value={value}
                    onChange={(e) => {
                        const newValue = Math.min(Math.max(parseInt(e.target.value) || min, min), max)
                        onChange(newValue)
                    }}
                    className="w-20 text-right border-0 focus-visible:ring-0"
                />

            </div>
            <Slider
                value={value ? [value] : undefined}
                max={max}
                min={min}
                step={step}
                onValueChange={([newValue]) => onChange(newValue)}
            />
            {explanation && <p className="text-sm text-gray-500">{explanation}</p>}
        </div>
    )
} 