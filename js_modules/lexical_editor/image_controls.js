export function applyImageLayout(figure, align) {
  const wrapped = align === "left" || align === "right";
  figure.style.boxSizing = "border-box";
  figure.style.clear = wrapped ? "none" : "both";
  figure.style.float = wrapped ? align : "none";
  figure.style.margin = align === "left"
    ? "0 16px 12px 0"
    : align === "right"
    ? "0 0 12px 16px"
    : "0 0 12px 0";
  figure.style.maxWidth = "100%";
  figure.style.textAlign = align;
  figure.style.width = wrapped ? "fit-content" : "100%";
}

function createImageAlignmentToolbar() {
  const toolbar = document.createElement("span");
  toolbar.className = "lexical-image-alignment";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Image alignment");
  toolbar.style.cssText =
    "position:absolute;top:8px;left:8px;z-index:2;display:none;gap:2px;padding:3px;background:white;border:1px solid #d1d5db;border-radius:6px;box-shadow:0 2px 6px #0002;font:12px/1.3 sans-serif;white-space:nowrap";
  for (const align of ["left", "center", "right"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = align[0].toUpperCase() + align.slice(1);
    button.dataset.imageAlign = align;
    button.setAttribute("aria-label", `Align image ${align}`);
    button.style.cssText =
      "border:0;border-radius:3px;padding:5px 8px;cursor:pointer;font:inherit";
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    toolbar.append(button);
  }
  return toolbar;
}

export function createImageFigure({ key, src, altText, width, height, align }) {
  const figure = document.createElement("figure");
  figure.className = "lexical-image";
  figure.contentEditable = "false";
  figure.dataset.lexicalImageKey = key;
  applyImageLayout(figure, align);

  const frame = document.createElement("span");
  frame.className = "lexical-image-frame";
  frame.style.display = "inline-block";
  frame.style.lineHeight = "0";
  frame.style.maxWidth = "100%";
  frame.style.position = "relative";

  const img = document.createElement("img");
  img.src = src;
  img.alt = altText;
  img.draggable = false;
  img.style.maxWidth = "100%";
  img.style.height = height ? `${height}px` : "auto";
  img.style.width = `${width}px`;
  img.style.display = "inline-block";
  img.style.verticalAlign = "top";
  img.style.border = "1px solid transparent";
  img.style.borderRadius = "2px";
  frame.append(img);
  const cornerLabel = {
    nw: "top left",
    ne: "top right",
    sw: "bottom left",
    se: "bottom right",
  };
  for (const corner of ["nw", "ne", "sw", "se"]) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className =
      `lexical-image-resize-handle lexical-image-resize-${corner}`;
    handle.dataset.lexicalImageResizeCorner = corner;
    handle.setAttribute(
      "aria-label",
      `Resize image from ${cornerLabel[corner]}`,
    );
    handle.style.background = "white";
    handle.style.border = "2px solid #2563eb";
    handle.style.borderRadius = "2px";
    handle.style.boxSizing = "border-box";
    handle.style.cursor = corner === "nw" || corner === "se"
      ? "nwse-resize"
      : "nesw-resize";
    handle.style.display = "none";
    handle.style.height = "12px";
    handle.style.margin = "0";
    handle.style.padding = "0";
    handle.style.position = "absolute";
    handle.style.width = "12px";
    handle.style.zIndex = "1";
    if (corner.includes("n")) handle.style.top = "-6px";
    if (corner.includes("s")) handle.style.bottom = "-6px";
    if (corner.includes("w")) handle.style.left = "-6px";
    if (corner.includes("e")) handle.style.right = "-6px";
    frame.append(handle);
  }
  frame.append(createImageAlignmentToolbar());
  figure.append(frame);
  return figure;
}
