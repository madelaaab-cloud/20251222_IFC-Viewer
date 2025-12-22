import { useEffect, useMemo, useRef, useState } from 'react';
import { Color } from 'three';
import { IFCViewerAPI } from 'web-ifc-viewer';
import {
  IFCBEAM,
  IFCCOLUMN,
  IFCDOOR,
  IFCSLAB,
  IFCWALL,
  IFCWINDOW
} from 'web-ifc';

const FILTERS = [
  { name: 'Walls', type: IFCWALL },
  { name: 'Slabs', type: IFCSLAB },
  { name: 'Columns', type: IFCCOLUMN },
  { name: 'Beams', type: IFCBEAM },
  { name: 'Doors', type: IFCDOOR },
  { name: 'Windows', type: IFCWINDOW }
];

export default function App() {
  const viewerRef = useRef<IFCViewerAPI | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [modelID, setModelID] = useState<number | null>(null);
  const [status, setStatus] = useState('Load an IFC file to begin.');
  const [properties, setProperties] = useState<string>('');
  const [clipEnabled, setClipEnabled] = useState(true);
  const [hiddenTypes, setHiddenTypes] = useState<Record<number, boolean>>({});

  const filterState = useMemo(() => {
    const result: Record<number, boolean> = {};
    for (const filter of FILTERS) {
      result[filter.type] = hiddenTypes[filter.type] ?? false;
    }
    return result;
  }, [hiddenTypes]);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new IFCViewerAPI({
      container: containerRef.current,
      backgroundColor: new Color(0xf3f5f7)
    });

    viewer.IFC.setWasmPath('/wasm/');
    viewer.grid.setGrid();
    viewer.axes.setAxes();
    viewer.clipper.active = true;

    viewerRef.current = viewer;

    const handleClick = async () => {
      const result = await viewer.IFC.selector.pickIfcItem();
      if (!result) {
        setProperties('');
        return;
      }

      const props = await viewer.IFC.getProperties(
        result.modelID,
        result.id,
        true,
        true
      );
      setProperties(JSON.stringify(props, null, 2));
    };

    const handleMove = () => {
      viewer.IFC.selector.prepickIfcItem();
    };

    const canvas = viewer.context.renderer.domElement;
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mousemove', handleMove);

    return () => {
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mousemove', handleMove);
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  const handleLoadIfc = async (file: File) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    setStatus('Loading IFC...');
    setProperties('');

    const url = URL.createObjectURL(file);
    try {
      const model = await viewer.IFC.loadIfcUrl(url);
      setModelID(model.modelID);
      setStatus(`Loaded: ${file.name}`);
      viewer.shadowDropper.renderShadow(model.modelID);
    } catch (error) {
      setStatus('Failed to load IFC.');
      // eslint-disable-next-line no-console
      console.error(error);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const handleToggleClip = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.clipper.active = !clipEnabled;
    setClipEnabled(!clipEnabled);
  };

  const handleAddPlane = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.clipper.createPlane();
  };

  const handleClearPlanes = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.clipper.deleteAllPlanes();
  };

  const toggleFilter = async (type: number) => {
    const viewer = viewerRef.current;
    if (!viewer || modelID === null) return;

    const shouldHide = !(hiddenTypes[type] ?? false);
    const items = await viewer.IFC.getAllItemsOfType(modelID, type, false);

    if (shouldHide) {
      viewer.IFC.hideItems(modelID, items);
    } else {
      viewer.IFC.showItems(modelID, items);
    }

    setHiddenTypes((prev) => ({ ...prev, [type]: shouldHide }));
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">20251222_IFC-Viewer</div>
          <div className="brand-sub">IFC upload, inspect, cut, and filter</div>
        </div>

        <div className="panel">
          <label className="file-input">
            <input
              type="file"
              accept=".ifc"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleLoadIfc(file);
              }}
            />
            <span>Upload IFC (up to 100MB)</span>
          </label>
          <div className="status">{status}</div>
        </div>

        <div className="panel">
          <div className="panel-title">Section / Cut</div>
          <div className="button-row">
            <button type="button" onClick={handleToggleClip}>
              {clipEnabled ? 'Disable clipping' : 'Enable clipping'}
            </button>
            <button type="button" onClick={handleAddPlane}>
              Add plane
            </button>
            <button type="button" onClick={handleClearPlanes}>
              Clear planes
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Filter elements</div>
          <div className="filter-list">
            {FILTERS.map((filter) => (
              <label key={filter.type} className="filter-item">
                <input
                  type="checkbox"
                  checked={!filterState[filter.type]}
                  onChange={() => void toggleFilter(filter.type)}
                  disabled={modelID === null}
                />
                <span>{filter.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Properties</div>
          <pre className="properties">
            {properties || 'Click a model element to view its properties.'}
          </pre>
        </div>
      </aside>

      <main className="viewer">
        <div className="viewer-hint">Scroll to zoom. Drag to orbit. Click to inspect.</div>
        <div ref={containerRef} className="viewer-canvas" />
      </main>
    </div>
  );
}
