# gridifier

[https://gridifier.tomasen.org/](https://gridifier.tomasen.org/)

**gridifier** is a Node.js/TypeScript command-line/web tool that can take a pre-modeled container **(at least 2×2)** and reconstructs it into a customized grid of storage compartments. Its primary goal is to eliminate the need for time-consuming and repetitive CAD work when you want to create multi-cell organizers at different sizes or heights.

The tool:
1. **extracts** a single cell from the input model
2. **slices** the cell into distinct sub-parts (corners, walls, floor, etc.)
3. **reassembles** those parts to create any given **N×M** container of arbitrary size and height while keeping the original styles

The final **container** is exported as an STL file for 3D printing or further CAD workflows.

## Features

- **Automatic Cell Extraction**: Extracts a single cell from a pre-modeled container (2×2 or larger).
- **Geometric Sub-Part Isolation**: Splits the cell geometry into distinct parts (walls, corners, floors) using 3D boolean operations (CSG).
- **Flexible Assembly**: Dynamically merges these parts into an N×M container, automatically placing corners, edges, floors, and optional dividers.
- **Parametric Scaling**: Adjust the cell dimensions and height to generate containers at custom sizes.
- **STL Input/Output**: Uses Three.js loaders and exporters to read and write STL files, ideal for 3D printing.
- **Optional Geometry Union**: Can merge all parts into a single unified geometry for better compatibility with some CAD tools.


## Known Issues

- **Non-manifold edges**: The current CSG implementation might produce non-manifold edges. This is a known issue with the Three.js CSG implementation. But, as long as you don't find 'floating' errors when slicing the model for 3d printing, you should be fine.
- **Dividers**: Currently, dividers are not supported.

---

## Installation
1. Clone this repository:
   ```bash
   git clone https://github.com/tomasen/gridifier.git
   cd gridifier

2. Install node 22 or higher

```bash
nvm install 22
nvm use 22
```

3.	Install dependencies:

```bash
npm install
```

4.	You can run the tool directly with:

```bash
npx ts-node src/index.ts
```

or install TypeScript globally if you prefer:

```bash
npm install -g typescript
```

### Usage

Run the tool using:

```bash
npx ts-node src/index.ts [options]

Command-Line Options

-i, --input <file>              Path to the input STL file (required)
-g, --input-grids <NxM>        Input grid size, e.g. "2x2" (required)
-r, --input-corner-radius <mm>  Corner radius in mm (required)
-h, --height <mm>              Final container height in mm (required)
-o, --output-grids <NxM>       Output grid size, e.g. "3x5" (required)
-f, --output-file <file>       Output STL file path (required)
-s, --output-grid-size <mm>    Custom output grid side length in mm (optional)
-d, --divider-thickness <mm>   Vertical divider thickness in mm (optional, default=0)
-u, --union-all                Union all parts into a single geometry (optional)
```

### Example

```bash
npx ts-node src/index.ts \
  --input ./examples/Container-Input.stl \
  -g 2x2 \
  -r 10 \
  -h 40 \
  -o 3x5 \
  -s 25 \
  -d 1 \
  -f ./output/myGridContainer.stl
```

## How It Works

1. **Load & Parse**: Reads the input STL via the Three.js STLLoader.
2. **Grid Extraction**: Detects the bounding box of the original container and extracts a single cell using CSG intersection.
3. **Component Isolation**: Subdivides the cell geometry into components:
   - Bottom corners (with 0, 1, or 2 walls)
   - Top corners (with 1 or 2 walls)
   - Side edges (top and bottom)
   - Side walls
   - Floor segments
4. **Parametric Scaling**: If `--output-grid-size` is provided, all components are uniformly scaled to match the desired dimension.
5. **Assembly**: Arranges all components into an N×M grid:
   - Places corner pieces at appropriate positions
   - Connects edges between corners
   - Fills walls and floor segments
   - Optionally adds dividers
6. **Final Processing**: 
   - Optionally unifies all geometry into a single solid
   - Fixes any non-manifold edges
   - Exports to STL for 3D printing

## Example

```bash
npx ts-node src/index.ts \
  --input ./examples/Container-Input.stl \
  -g 4x2 \
  -s 10 \
  -h 40 \
  --rows 3 \
  --cols 5 \
  -l 25 \
  -d 1 \
  -o ./output/myGridContainer.stl
```

## Debugging

•	Debug logs and intermediate .stl files (base geometry, single cell, subparts) will be generated in a `./debug` folder when it exists.

## License

MIT License. See LICENSE for details.

Happy Gridifying!

