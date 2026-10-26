import * as lexical from "lexical";
import { applyImageLayout, createImageFigure } from "./image_controls.js";

/** Direct videos can supply a frame when their host permits canvas access. */
export function captureVideoThumbnail(url) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    const finish = (thumbnailData = null) => {
      clearTimeout(timer);
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      resolve(thumbnailData);
    };
    const timer = setTimeout(() => finish(), 6000);
    video.onerror = () => finish();
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration / 2 || 0);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 960;
        canvas.height = Math.round(960 * video.videoHeight / video.videoWidth);
        if (!canvas.height || canvas.height > 1920) return finish();
        canvas.getContext("2d").drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        finish(canvas.toDataURL("image/jpeg", 0.85));
      } catch {
        finish();
      }
    };
    video.src = url;
  });
}

/** Only recognized players and direct HTTPS video files can create embeds. */
export function videoSource(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let id;
  if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
    id = url.pathname === "/watch"
      ? url.searchParams.get("v")
      : url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1];
  } else if (host === "youtu.be") {
    id = url.pathname.slice(1);
  }
  if (id && /^[\w-]{11}$/.test(id)) {
    return {
      url: `https://www.youtube.com/watch?v=${id}`,
      src: `https://www.youtube-nocookie.com/embed/${id}`,
      iframe: true,
    };
  }
  if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
    const match = url.pathname.match(
      /^\/(?:video\/)?([0-9]+)(?:\/([a-zA-Z0-9]+))?$/,
    );
    id = match?.[1];
    const hash = match?.[2] || url.searchParams.get("h");
    if (id) {
      if (hash && !/^[a-zA-Z0-9]+$/.test(hash)) return null;
      return {
        url: `https://vimeo.com/${id}${hash ? `/${hash}` : ""}`,
        src: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ""}`,
        iframe: true,
      };
    }
  }
  if (/\.(mp4|webm)$/i.test(url.pathname)) {
    return { url: url.href, src: url.href, iframe: false };
  }
  return null;
}

export class VideoNode extends lexical.ElementNode {
  static getType() {
    return "video";
  }

  static clone(node) {
    return new VideoNode(
      node.__url,
      node.__thumbnail,
      node.__width,
      node.__align,
      node.__key,
    );
  }

  constructor(url = "", thumbnail = null, width = 652.8, align = "left", key) {
    super(key);
    this.__url = videoSource(url)?.url || "";
    this.__thumbnail = thumbnail;
    this.__width = Number.isFinite(width)
      ? Math.max(80, Math.min(652.8, width))
      : 652.8;
    this.__align = ["left", "center", "right"].includes(align) ? align : "left";
  }

  static importJSON(value) {
    return new VideoNode(value.url, value.thumbnail, value.width, value.align);
  }

  exportJSON() {
    return {
      ...super.exportJSON(),
      type: "video",
      version: 1,
      url: this.__url,
      thumbnail: this.__thumbnail,
      width: this.__width,
      align: this.__align,
    };
  }

  getTextContent() {
    return this.__url;
  }

  createDOM() {
    const figure = createImageFigure({
      key: this.getKey(),
      src: this.__thumbnail?.src ||
        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"/>',
      altText: "Video thumbnail",
      width: this.__width,
      align: this.__align,
    });
    figure.classList.add("lexical-video");
    figure.style.lineHeight = "1.56";
    const image = figure.querySelector("img");
    image.style.aspectRatio = "16 / 9";
    image.style.objectFit = "cover";
    image.style.background = "#e8edf2";
    const frame = figure.querySelector(".lexical-image-frame");
    const play = document.createElement("span");
    play.setAttribute("aria-hidden", "true");
    play.style.cssText =
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:72px;height:50.667px;max-width:60%;max-height:60%;border-radius:6.667px;background:#18212b;display:grid;place-items:center;pointer-events:none";
    const triangle = document.createElement("span");
    triangle.style.cssText =
      "width:20px;height:24px;max-width:60%;max-height:60%;background:white;clip-path:polygon(0 0,0 100%,100% 50%)";
    play.append(triangle);
    frame.append(play);
    const source = videoSource(this.__url);
    if (!source) return figure;
    const link = document.createElement("a");
    link.href = source.url;
    link.textContent = `Watch video: ${source.url}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    figure.append(document.createElement("br"), link);
    const editor = lexical.$getEditor();
    if (editor.isEditable()) {
      const key = this.getKey();
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove video";
      remove.style.marginLeft = "12px";
      remove.addEventListener("click", () => {
        editor.update(() => lexical.$getNodeByKey(key)?.remove());
      });
      figure.append(remove);
    }
    return figure;
  }

  updateDOM(previous, figure) {
    if (
      previous.__url !== this.__url || previous.__thumbnail !== this.__thumbnail
    ) {
      return true;
    }
    if (previous.__width !== this.__width) {
      figure.querySelector("img").style.width = `${this.__width}px`;
    }
    if (previous.__align !== this.__align) {
      applyImageLayout(figure, this.__align);
    }
    return false;
  }

  setWidth(width) {
    this.getWritable().__width = Math.max(
      80,
      Math.min(652.8, Math.round(width)),
    );
  }

  getWidth() {
    return this.getLatest().__width;
  }

  setAlign(align) {
    this.getWritable().__align = ["left", "center", "right"].includes(align)
      ? align
      : "left";
  }

  exportDOM() {
    const element = document.createElement("a");
    element.href = this.__url;
    element.textContent = this.__url;
    return { element };
  }
}
