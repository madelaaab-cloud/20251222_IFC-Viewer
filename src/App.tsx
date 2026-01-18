import { useEffect, useRef, useState } from 'react';
import {
  Box3,
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  RepeatWrapping,
  Vector3
} from 'three';
import { IfcViewerAPI } from 'web-ifc-viewer';
import {
  IFCBEAM,
  IFCBUILDING,
  IFCBUILDINGSTOREY,
  IFCCOLUMN,
  IFCCOVERING,
  IFCCURTAINWALL,
  IFCDISTRIBUTIONELEMENT,
  IFCDOOR,
  IFCFURNISHINGELEMENT,
  IFCMEMBER,
  IFCPRODUCT,
  IFCPLATE,
  IFCRAILING,
  IFCROOF,
  IFCSITE,
  IFCSLAB,
  IFCSPACE,
  IFCSTAIR,
  IFCWALL,
  IFCWALLSTANDARDCASE,
  IFCWINDOW
} from 'web-ifc';

const GRID_MAJOR_M = 1;
const GRID_MINOR_M = 0.2;

const IFC_CLASS_LIST = [
  { name: 'Walls', type: IFCWALL },
  { name: 'Wall (Std)', type: IFCWALLSTANDARDCASE },
  { name: 'Slabs', type: IFCSLAB },
  { name: 'Columns', type: IFCCOLUMN },
  { name: 'Beams', type: IFCBEAM },
  { name: 'Doors', type: IFCDOOR },
  { name: 'Windows', type: IFCWINDOW },
  { name: 'Roofs', type: IFCROOF },
  { name: 'Stairs', type: IFCSTAIR },
  { name: 'Railings', type: IFCRAILING },
  { name: 'Members', type: IFCMEMBER },
  { name: 'Plates', type: IFCPLATE },
  { name: 'Curtain Walls', type: IFCCURTAINWALL },
  { name: 'Coverings', type: IFCCOVERING },
  { name: 'Furnishing', type: IFCFURNISHINGELEMENT },
  { name: 'Distribution', type: IFCDISTRIBUTIONELEMENT },
  { name: 'Spaces', type: IFCSPACE },
  { name: 'Storeys', type: IFCBUILDINGSTOREY },
  { name: 'Buildings', type: IFCBUILDING },
  { name: 'Sites', type: IFCSITE }
];

export default function App() {
  // Viewer instance and DOM container.
  const viewerRef = useRef<IfcViewerAPI | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [modelID, setModelID] = useState<number | null>(null);
  const [status, setStatus] = useState('Load an IFC file to begin.');
  const [properties, setProperties] = useState<any | null>(null);
  const [clipEnabled, setClipEnabled] = useState(true);
  const [placingPlane, setPlacingPlane] = useState(false);
  const placingPlaneRef = useRef(false);
  // Cutting plane texture (blue with grid).
  const planeGridRef = useRef<CanvasTexture | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [classCounts, setClassCounts] = useState<
    { name: string; type: number; count: number }[]
  >([]);
  const [selectedClassType, setSelectedClassType] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
    hasSelection: boolean;
  }>({ x: 0, y: 0, visible: false, hasSelection: false });
  const selectedItemRef = useRef<{ modelID: number; id: number } | null>(null);
  // Highlight overlay for class selection.
  const highlightSubsetRef = useRef<any | null>(null);
  const highlightMaterialRef = useRef<MeshBasicMaterial | null>(null);
  const transparencyCacheRef = useRef<
    WeakMap<any, { opacity: number; transparent: boolean; depthWrite: boolean }>
  >(new WeakMap());
  const hiddenIdsRef = useRef<Set<number>>(new Set());
  const visibleSubsetRef = useRef<any | null>(null);
  const allProductIdsRef = useRef<number[] | null>(null);
  const typeCacheRef = useRef<Record<number, number[]>>({});

  // Extract express IDs regardless of IFC.js return shape.
  const normalizeIds = (items: any[]) =>
    items
      .map((item) => (typeof item === 'number' ? item : item?.expressID))
      .filter((id): id is number => typeof id === 'number');

  const ensureAllProductIds = async (
    viewer: IfcViewerAPI,
    currentModelId: number
  ) => {
    if (allProductIdsRef.current) return;
    const items = await viewer.IFC.getAllItemsOfType(
      currentModelId,
      IFCPRODUCT,
      false
    );
    let ids = normalizeIds(items);
    if (!ids.length) {
      const classIds = await Promise.all(
        IFC_CLASS_LIST.map(async (entry) => {
          const classItems = await viewer.IFC.getAllItemsOfType(
            currentModelId,
            entry.type,
            false
          );
          return normalizeIds(classItems);
        })
      );
      const merged = new Set<number>();
      classIds.forEach((list) => list.forEach((id) => merged.add(id)));
      ids = Array.from(merged);
    }
    allProductIdsRef.current = ids;
  };

  // Cache IFC type IDs to avoid repeated scans.
  const getTypeIds = async (
    viewer: IfcViewerAPI,
    currentModelId: number,
    type: number
  ) => {
    const cached = typeCacheRef.current[type];
    if (cached) return cached;
    const items = await viewer.IFC.getAllItemsOfType(
      currentModelId,
      type,
      false
    );
    const ids = normalizeIds(items);
    typeCacheRef.current[type] = ids;
    return ids;
  };

  const toValue = (value: any) => {
    if (value == null) return '';
    if (typeof value === 'object' && 'value' in value) return String(value.value);
    return String(value);
  };

  const toName = (value: any) => {
    if (value == null) return '';
    if (typeof value === 'object' && 'value' in value) return String(value.value);
    return String(value);
  };

  // Flatten IFC properties into a simple Parameter/Value list.
  const buildParamRows = (props: any) => {
    const rows: { name: string; value: string }[] = [];
    if (!props) return rows;

    if (props.psets) {
      for (const set of props.psets) {
        if (!set?.HasProperties) continue;
        for (const prop of set.HasProperties) {
          const name = toName(prop?.Name);
          const value = toValue(prop?.NominalValue ?? prop?.HasProperties);
          if (name) rows.push({ name, value });
        }
      }
    }

    const baseFields = ['GlobalId', 'Name', 'Description', 'ObjectType', 'PredefinedType'];
    for (const field of baseFields) {
      const value = toValue(props[field]);
      if (value) rows.push({ name: field, value });
    }

    return rows;
  };

  const fetchProperties = async (
    viewer: IfcViewerAPI,
    currentModelId: number,
    expressId: number
  ) => {
    try {
      const props = await viewer.IFC.getProperties(
        currentModelId,
        expressId,
        true,
        true
      );
      if (props) return props;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to read IFC properties', error);
    }
    try {
      const ifcManager = viewer.IFC.loader.ifcManager;
      const item = await ifcManager.getItemProperties(currentModelId, expressId, true);
      let psets: any[] = [];
      let mats: any[] = [];
      let type: any[] = [];
      try {
        psets = await ifcManager.getPropertySets(currentModelId, expressId, true);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to read IFC property sets', error);
      }
      try {
        mats = await ifcManager.getMaterialsProperties(currentModelId, expressId, true);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to read IFC materials', error);
      }
      try {
        type = await ifcManager.getTypeProperties(currentModelId, expressId, true);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to read IFC type properties', error);
      }
      return { ...item, psets, mats, type };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to read fallback IFC properties', error);
      return null;
    }
  };

  // Compute counts per IFC class for the chips.
  const updateClassCounts = async (
    viewer: IfcViewerAPI,
    currentModelId: number
  ) => {
    const results = await Promise.all(
      IFC_CLASS_LIST.map(async (entry) => {
        const items = await viewer.IFC.getAllItemsOfType(
          currentModelId,
          entry.type,
          false
        );
        return { name: entry.name, type: entry.type, count: normalizeIds(items).length };
      })
    );
    const filtered = results.filter((item) => item.count > 0);
    filtered.sort((a, b) => b.count - a.count);
    setClassCounts(filtered);
  };

  const rebuildVisibleSubset = async (
    viewer: IfcViewerAPI,
    currentModelId: number
  ) => {
    const ifcManager = viewer.IFC.loader.ifcManager;
    const hiddenIds = hiddenIdsRef.current;
    const pickables = viewer.context.items.pickableIfcModels;

    if (visibleSubsetRef.current) {
      ifcManager.removeSubset(currentModelId, undefined, 'visible');
      const index = pickables.indexOf(visibleSubsetRef.current as any);
      if (index >= 0) pickables.splice(index, 1);
      visibleSubsetRef.current = null;
    }

    const originalModel = viewer.context.items.ifcModels.find(
      (model) => model.modelID === currentModelId
    );

    if (!hiddenIds.size) {
      if (originalModel) {
        originalModel.visible = true;
        if (!pickables.includes(originalModel)) {
          pickables.push(originalModel);
        }
      }
      return;
    }

    await ensureAllProductIds(viewer, currentModelId);
    const allIds = allProductIdsRef.current ?? [];
    if (!allIds.length) {
      if (originalModel) {
        originalModel.visible = true;
        if (!pickables.includes(originalModel)) {
          pickables.push(originalModel);
        }
      }
      return;
    }
    const visibleIds = allIds.filter((id) => !hiddenIds.has(id));

    if (!visibleIds.length) {
      if (originalModel) {
        originalModel.visible = false;
      }
      pickables.length = 0;
      return;
    }

    const subset = ifcManager.createSubset({
      scene: viewer.context.getScene(),
      modelID: currentModelId,
      ids: visibleIds,
      removePrevious: true,
      customID: 'visible'
    });

    if (subset) {
      if (originalModel) originalModel.visible = false;
      pickables.length = 0;
      visibleSubsetRef.current = subset;
      pickables.push(subset as any);
    } else if (originalModel) {
      originalModel.visible = true;
      if (!pickables.includes(originalModel)) {
        pickables.push(originalModel);
      }
    }
  };

  useEffect(() => {
    // Build a reusable grid texture for clipping planes.
    if (!planeGridRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(47, 102, 199, 0.25)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const majorDivs = GRID_MAJOR_M / GRID_MINOR_M;
        const minorStep = canvas.width / majorDivs;

        ctx.strokeStyle = 'rgba(170, 170, 170, 0.6)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= canvas.width; i += minorStep) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, canvas.height);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(canvas.width, i);
          ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(140, 140, 140, 0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
      }
      const texture = new CanvasTexture(canvas);
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set(1, 1);
      planeGridRef.current = texture;
    }

    // Initialize the viewer once.
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new IfcViewerAPI({
      container: containerRef.current,
      backgroundColor: new Color(0xf3f5f7)
    });

    viewer.IFC.setWasmPath('/wasm/');
    void viewer.IFC.applyWebIfcConfig({
      COORDINATE_TO_ORIGIN: true,
      USE_FAST_BOOLS: true
    });
    viewer.grid.setGrid(50, 50);
    viewer.axes.setAxes();
    viewer.clipper.active = true;
    viewer.clipper.edgesActive = true;

    viewerRef.current = viewer;

    const handleClick = async (event: MouseEvent) => {
      setContextMenu((prev) => ({ ...prev, visible: false }));
      // Sync mouse position for accurate raycasting.
      const target = event.currentTarget as HTMLCanvasElement;
      const bounds = target.getBoundingClientRect();
      const mouse = (viewer.context as any).mouse;
      if (mouse) {
        mouse.rawPosition.x = event.clientX;
        mouse.rawPosition.y = event.clientY;
        mouse.position.x =
          ((event.clientX - bounds.left) / (bounds.right - bounds.left)) * 2 - 1;
        mouse.position.y =
          -((event.clientY - bounds.top) / (bounds.bottom - bounds.top)) * 2 + 1;
      }

      // Place a cutting plane on the clicked face.
      if (placingPlaneRef.current) {
        const before = viewer.clipper.planes.length;
        viewer.clipper.createPlane();
        const after = viewer.clipper.planes.length;
        if (after > before) {
          const plane = viewer.clipper.planes[after - 1];
          const mesh = plane.planeMesh;
          const material = Array.isArray(mesh?.material)
            ? mesh.material[0]
            : mesh?.material;
          if (material && 'color' in material) {
            const planeMaterial = material as any;
            planeMaterial.color = new Color(0x2f66c7);
            planeMaterial.opacity = 0.25;
            planeMaterial.transparent = true;
            planeMaterial.map = planeGridRef.current;
            if (planeMaterial.map) {
              const repeats = Math.max(1, viewer.clipper.planeSize / GRID_MAJOR_M);
              planeMaterial.map.repeat.set(repeats, repeats);
            }
            planeMaterial.needsUpdate = true;
          }
        }
        placingPlaneRef.current = false;
        setPlacingPlane(false);
        return;
      }

      if (selectedClassType !== null && modelID !== null) {
        clearClassHighlight(viewer, modelID);
      }

      // Regular selection for properties.
      let result = await viewer.IFC.selector.pickIfcItem();
      if (!result) {
        const intersect = viewer.context.castRayIfc();
        if (intersect) {
          const mesh = intersect.object as any;
          const id = viewer.IFC.loader.ifcManager.getExpressId(
            mesh.geometry,
            intersect.faceIndex ?? 0
          );
          if (id !== undefined) {
            result = { modelID: mesh.modelID, id };
          }
        }
      }

      if (!result) {
        viewer.IFC.selector.unpickIfcItems();
        setProperties(null);
        return;
      }

      const props = await fetchProperties(viewer, result.modelID, result.id);
      setProperties(props);
    };

    const handleMove = () => {
      // Pre-highlight only when not placing a plane.
      if (placingPlaneRef.current) return;
      void viewer.IFC.selector.prePickIfcItem();
    };

    const handleContextMenu = async (event: MouseEvent) => {
      event.preventDefault();
      const target = event.currentTarget as HTMLCanvasElement;
      const bounds = target.getBoundingClientRect();
      const mouse = (viewer.context as any).mouse;
      if (mouse) {
        mouse.rawPosition.x = event.clientX;
        mouse.rawPosition.y = event.clientY;
        mouse.position.x =
          ((event.clientX - bounds.left) / (bounds.right - bounds.left)) * 2 - 1;
        mouse.position.y =
          -((event.clientY - bounds.top) / (bounds.bottom - bounds.top)) * 2 + 1;
      }

      if (selectedClassType !== null && modelID !== null) {
        clearClassHighlight(viewer, modelID);
      }

      const result = await viewer.IFC.selector.pickIfcItem();
      if (!result) {
        const intersect = viewer.context.castRayIfc();
        if (intersect) {
          const mesh = intersect.object as any;
          const id = viewer.IFC.loader.ifcManager.getExpressId(
            mesh.geometry,
            intersect.faceIndex ?? 0
          );
          if (id !== undefined) {
            selectedItemRef.current = { modelID: mesh.modelID, id };
          } else {
            selectedItemRef.current = null;
          }
        } else {
          selectedItemRef.current = null;
        }
      } else {
        selectedItemRef.current = { modelID: result.modelID, id: result.id };
      }

      setContextMenu({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        visible: true,
        hasSelection: Boolean(selectedItemRef.current)
      });
    };

    const canvas = viewer.context.getDomElement();
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('contextmenu', handleContextMenu);

    return () => {
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mousemove', handleMove);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    document.body.dataset.theme = theme;
    const existingViewer = viewerRef.current;
    if (!existingViewer) return;
    const background = theme === 'dark' ? new Color(0x0f131a) : new Color(0xf3f5f7);
    existingViewer.context.getScene().background = background;
    existingViewer.context.getRenderer().setClearColor(background);
  }, [theme]);

  // Load IFC and set up viewer state.
  const handleLoadIfc = async (file: File) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.clipper.deleteAllPlanes();
    viewer.clipper.active = false;
    setClipEnabled(false);

    if (modelID !== null) {
      clearClassHighlight(viewer, modelID);
    }
    transparencyCacheRef.current = new WeakMap();
    hiddenIdsRef.current = new Set();
    visibleSubsetRef.current = null;
    allProductIdsRef.current = null;

    setStatus('Loading IFC...');
    setProperties(null);
    setSelectedClassType(null);
    typeCacheRef.current = {};

    const url = URL.createObjectURL(file);
    try {
      const model = await viewer.IFC.loadIfcUrl(url);
      if (!model) {
        setStatus('Failed to load IFC.');
        return;
      }
      if (model.geometry) {
        model.geometry.computeBoundingBox();
        model.geometry.computeBoundingSphere();
      }
      model.visible = true;
      viewer.context.getScene().add(model);
      setModelID(model.modelID);
      setStatus(`Loaded: ${file.name}`);
      viewer.shadowDropper.renderShadow(model.modelID);
      let bounds = new Box3().setFromObject(model);
      let center = bounds.getCenter(new Vector3());
      let size = bounds.getSize(new Vector3());
      const maxSize = Math.max(size.x, size.y, size.z) || 1;
      if (center.length() > 10000 || maxSize > 100000) {
        model.position.sub(center);
        model.updateMatrixWorld(true);
        bounds = new Box3().setFromObject(model);
        center = bounds.getCenter(new Vector3());
        size = bounds.getSize(new Vector3());
      }
      viewer.clipper.planeSize = Math.max(size.x, size.y, size.z, 5);
      setTimeout(() => {
        viewerRef.current?.context.fitToFrame();
      }, 0);
      await updateClassCounts(viewer, model.modelID);
      if (selectedClassType !== null) {
        await applyClassHighlight(viewer, model.modelID, selectedClassType);
      }
  } catch (error) {
      setStatus('Failed to load IFC.');
      // eslint-disable-next-line no-console
      console.error(error);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // Fade non-selected geometry.
  const setMeshTransparency = (mesh: any, opacity: number) => {
    if (!mesh?.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!transparencyCacheRef.current.has(material)) {
        transparencyCacheRef.current.set(material, {
          opacity: material.opacity ?? 1,
          transparent: material.transparent ?? false,
          depthWrite: material.depthWrite ?? true
        });
      }
      material.transparent = true;
      material.opacity = opacity;
      material.depthWrite = false;
    }
  };

  // Restore original materials after clearing highlight.
  const restoreMeshTransparency = (mesh: any) => {
    if (!mesh?.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const cached = transparencyCacheRef.current.get(material);
      if (!cached) continue;
      material.opacity = cached.opacity;
      material.transparent = cached.transparent;
      material.depthWrite = cached.depthWrite;
    }
  };

  const getDisplayMesh = (viewer: IfcViewerAPI, currentModelId: number) => {
    if (visibleSubsetRef.current) return visibleSubsetRef.current;
    return viewer.context.items.ifcModels.find(
      (model) => model.modelID === currentModelId
    );
  };

  const clearClassHighlight = (viewer: IfcViewerAPI, currentModelId: number) => {
    if (highlightSubsetRef.current) {
      viewer.IFC.loader.ifcManager.removeSubset(
        currentModelId,
        highlightMaterialRef.current ?? undefined,
        'class-highlight'
      );
      highlightSubsetRef.current = null;
    }
    const target = getDisplayMesh(viewer, currentModelId);
    if (target) restoreMeshTransparency(target);
    setSelectedClassType(null);
  };

  // Highlight all elements of a class and fade the rest.
  const applyClassHighlight = async (
    viewer: IfcViewerAPI,
    currentModelId: number,
    type: number
  ) => {
    let ids: number[] = [];
    try {
      ids = await getTypeIds(viewer, currentModelId, type);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to resolve IFC class IDs', error);
    }
    clearClassHighlight(viewer, currentModelId);
    if (!ids.length) return;

    if (!highlightMaterialRef.current) {
      highlightMaterialRef.current = new MeshBasicMaterial({
        color: 0x2f66c7,
        transparent: true,
        opacity: 0.95
      });
    }
    highlightMaterialRef.current.clippingPlanes = viewer.context.getClippingPlanes();

    const subset = viewer.IFC.loader.ifcManager.createSubset({
      scene: viewer.context.getScene(),
      modelID: currentModelId,
      ids,
      removePrevious: true,
      material: highlightMaterialRef.current,
      customID: 'class-highlight'
    });

    if (subset) highlightSubsetRef.current = subset;

    const target = getDisplayMesh(viewer, currentModelId);
    if (target) setMeshTransparency(target, 0.2);
    setSelectedClassType(type);
  };

  const handleHideSelected = async () => {
    const viewer = viewerRef.current;
    if (!viewer || modelID === null) return;
    const selected = selectedItemRef.current;
    if (!selected || selected.modelID !== modelID) return;
    await ensureAllProductIds(viewer, modelID);
    if (allProductIdsRef.current && !allProductIdsRef.current.includes(selected.id)) {
      allProductIdsRef.current = [...allProductIdsRef.current, selected.id];
    }
    hiddenIdsRef.current.add(selected.id);
    viewer.IFC.selector.unpickIfcItems();
    setContextMenu((prev) => ({ ...prev, visible: false }));
    await rebuildVisibleSubset(viewer, modelID);
  };

  const handleShowAll = async () => {
    const viewer = viewerRef.current;
    if (!viewer || modelID === null) return;
    hiddenIdsRef.current.clear();
    setContextMenu((prev) => ({ ...prev, visible: false }));
    await rebuildVisibleSubset(viewer, modelID);
  };

  const handleToggleClip = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const next = !viewer.clipper.active;
    viewer.clipper.active = next;
    setClipEnabled(next);
  };

  const handleAddPlane = () => {
    const viewer = viewerRef.current;
    if (!viewer || modelID === null) return;
    viewer.clipper.active = true;
    setClipEnabled(true);
    viewer.IFC.selector.unPrepickIfcItems();
    viewer.IFC.selector.unpickIfcItems();
    placingPlaneRef.current = true;
    setPlacingPlane(true);
  };

  const handleClearPlanes = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.clipper.deleteAllPlanes();
    placingPlaneRef.current = false;
    setPlacingPlane(false);
  };

  const handleHighlightClass = async (type: number) => {
    const viewer = viewerRef.current;
    if (!viewer || modelID === null) return;
    if (selectedClassType === type) {
      clearClassHighlight(viewer, modelID);
      return;
    }
    await applyClassHighlight(viewer, modelID, type);
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
            <span>Upload IFC</span>
          </label>
          <div className="status">{status}</div>
        </div>

        <div className="panel">
          <div className="panel-title">Section / Cut</div>
          <div className="button-row">
            <button type="button" onClick={handleToggleClip}>
              {clipEnabled ? 'Disable clipping' : 'Enable clipping'}
            </button>
            <button
              type="button"
              onClick={() => viewerRef.current?.context.fitToFrame()}
            >
              Zoom to model
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
          <div className="panel-title">Theme</div>
          <div className="button-row">
            <button
              type="button"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Properties</div>
          {properties ? (
            <div className="properties-table">
              <div className="properties-row properties-head">
                <div>Parameter</div>
                <div>Value</div>
              </div>
              {buildParamRows(properties).map((row, index) => (
                <div key={`${row.name}-${index}`} className="properties-row">
                  <div>{row.name}</div>
                  <div>{row.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="properties-empty">
              Click a model element to view its properties.
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">Element counts</div>
          {classCounts.length > 0 ? (
            <div className="chart-buttons">
              {classCounts.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className={item.type === selectedClassType ? 'chip active' : 'chip'}
                  onClick={() => void handleHighlightClass(item.type)}
                >
                  {item.name} ({item.count})
                </button>
              ))}
              {selectedClassType !== null && (
                <button
                  type="button"
                  className="chip clear"
                  onClick={() => {
                    const viewer = viewerRef.current;
                    if (viewer && modelID !== null) {
                      clearClassHighlight(viewer, modelID);
                    }
                  }}
                >
                  Clear highlight
                </button>
              )}
            </div>
          ) : (
            <div className="properties-empty">Load a model to see counts.</div>
          )}
        </div>
      </aside>

      <main className="viewer">
        <div className="viewer-hint">
          {placingPlane
            ? 'Click a model face to place a section plane. Drag plane edges to move/rotate.'
            : 'Scroll to zoom. Drag to orbit. Click to inspect.'}
        </div>
        {contextMenu.visible && (
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              disabled={!contextMenu.hasSelection}
              onClick={() => void handleHideSelected()}
            >
              Hide selected
            </button>
            <button type="button" onClick={() => void handleShowAll()}>
              Show all
            </button>
          </div>
        )}
        <div ref={containerRef} className="viewer-canvas" />
      </main>
    </div>
  );
}
