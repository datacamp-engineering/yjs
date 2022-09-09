import * as Y from '../src/index.js'

/**
  * @param {any} [cell]
  */
const createYMapFromBaseCellJSON = (cell) => {
  const ymap = new Y.Map();
  const ysource = new Y.Text();
  ymap.set("source", ysource);
  ymap.set("metadata", cell.metadata);
  ymap.set("id", cell.id);
  if (Array.isArray(cell.source)) {
    ysource.insert(
      0,
      cell.source
      .map((/** @type string */ s) => s.replace(/\r\n/g, "\n").replace(/\r/g, "\n"))
        .join("")
    );
  } else {
    ysource.insert(0, cell.source.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  }
  return ymap;
};

/**
  * @param {any} [cell]
  */
const createYMapFromCodeCellJSON = (cell) => {
  const ymap = createYMapFromBaseCellJSON(cell);
  ymap.set("cell_type", "code");
  ymap.set("execution_count", cell.execution_count ?? null);
  const youtputs = new Y.Array();
  ymap.set("outputs", youtputs);
  youtputs.insert(0, cell.outputs ?? []);
  return ymap;
};

/**
  * @param {any} [cell]
  */
const createYMapFromMarkdownCellJSON = (cell) => {
  const ymap = createYMapFromBaseCellJSON(cell);
  ymap.set("cell_type", "markdown");
  return ymap;
};

/**
  * @param {any} [cell]
  */
const createYMapFromRawCellJSON = (cell) => {
  const ymap = createYMapFromBaseCellJSON(cell);
  ymap.set("cell_type", "raw");
  return ymap;
};

/**
  * @param {any} [cell]
  */
const createYMapFromCellJSON = (cell) => {
  switch (cell.cell_type) {
    case "code":
      return createYMapFromCodeCellJSON(cell);

    case "markdown":
      return createYMapFromMarkdownCellJSON(cell);

    default:
      return createYMapFromRawCellJSON(cell);
  }
};

/** 
  * @param {any} [notebook]
  * @param {() => void} [onCell]
  * */
export const createYDocFromNotebookJSON = (notebook, ydoc = new Y.Doc(), onCell) => {
  const ycells = ydoc.getArray("cells");
  notebook.cells.forEach((/** @type any */cell) => {
    ycells.push([createYMapFromCellJSON(cell)]);
    if (onCell != null) {
      onCell()
    }
  });
  const ymeta = ydoc.getMap("meta");
  ymeta.set(
    "metadata",
    Object.fromEntries(
      Object.entries(notebook.metadata).filter(
        ([key]) => key !== "orig_nbformat"
      )
    )
  );
  const ystate = ydoc.getMap("state");
  ystate.set("nbformat", notebook.nbformat);
  let nbformatMinor = notebook.nbformat_minor;
  // If the major notebook format version is 4, and the minor is 4, we can
  // safely convert it to minor version 5. This is because the only difference
  // between the minor versions is the addition of ids to the cells. We do this
  // automatically, since we require them for commenting.
  if (notebook.nbformat === 4 && nbformatMinor === 4) {
    nbformatMinor = 5;
  }
  ystate.set("nbformatMinor", nbformatMinor);
  ystate.set("dirty", true);
  return ydoc;
};

/**
 * NotebookModel.toJSON with _ensureMetadata
* @param {any} ydocMetadata
 */
const metadataToJSON = (
  ydocMetadata,
) => {
  const metadata = { ...ydocMetadata };
  if (metadata.language_info == null) {
    metadata.language_info = { name: '' };
  }
  if (metadata.kernelspec == null) {
    metadata.kernelspec = { display_name: '', name: '' };
  }
  return metadata;
};

/**
  * @param {Y.Doc} ydoc
  */
const cellsToJSON = (ydoc)  => {
  return ydoc.getArray('cells').toJSON();
};

/**
  * @param {Y.Doc} ydoc
  */
export const notebookYDocToJSON = (ydoc) => {
  const notebook = {
    cells: cellsToJSON(ydoc),
    metadata: metadataToJSON(
      ydoc
        .getMap('meta')
        .get('metadata'),
    ),
    nbformat: ydoc.getMap('state').get('nbformat'),
    nbformat_minor: ydoc.getMap('state').get('nbformatMinor'),
  };
  return notebook;
};
