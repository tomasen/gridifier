import { Input } from "./input"
import { Slider } from "./slider"
import React from "react"
import { debounce } from "lodash"

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
    const [currentMax, setCurrentMax] = React.useState(max)
    const ABSOLUTE_MAX = 1000

    const debouncedSetMax = React.useCallback(
        React.useMemo(
            () =>
                debounce((newValue: number) => {
                    if (newValue > currentMax * 0.8) {
                        const newMax = Math.min(currentMax + Math.min(Math.ceil(currentMax * 0.2), 20), ABSOLUTE_MAX)
                        setCurrentMax(newMax)
                    }
                }, 300),
            [currentMax]
        ),
        [currentMax]
    )

    const handleSliderChange = ([newValue]: number[]) => {
        debouncedSetMax(newValue)
        onChange(newValue)
    }

    React.useEffect(() => {
        return () => {
            debouncedSetMax.cancel()
        }
    }, [debouncedSetMax])

    return (
        <div className={className}>
            <div className="flex justify-between items-center">
                <label className="text-sm font-medium">{label}</label>
                <Input
                    type="number"
                    value={value}
                    onChange={(e) => {
                        const newValue = Math.min(Math.max(parseInt(e.target.value) || min, min), currentMax)
                        onChange(newValue)
                    }}
                    className="w-20 text-right border-0 focus-visible:ring-0"
                />
            </div>
            <Slider
                value={value ? [value] : undefined}
                max={currentMax}
                min={min}
                step={step}
                onValueChange={handleSliderChange}
            />
            {explanation && <p className="text-sm text-gray-500">{explanation}</p>}
        </div>
    )
} 