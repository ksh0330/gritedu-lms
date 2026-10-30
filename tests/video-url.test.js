const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const helperSource = fs.readFileSync(path.join(root, "assets/js/utils/video-url.js"), "utf8");
const helper = import(`data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`);

test("online player uses the tested URL normalizer", () => {
  const page = fs.readFileSync(path.join(root, "assets/js/pages/student-course.js"), "utf8");
  const cms = fs.readFileSync(path.join(root, "assets/js/pages/admin-courses.js"), "utf8");
  const instructor = fs.readFileSync(path.join(root, "assets/js/pages/instructor-dashboard/context.js"), "utf8");
  assert.match(page, /import \{ normalizeVideoUrl \} from "\/assets\/js\/utils\/video-url\.js"/);
  assert.match(page, /const videoInfo = normalizeVideoUrl\(videoUrl\)/);
  assert.match(cms, /import \{ normalizeVideoUrl \} from "\/assets\/js\/utils\/video-url\.js"/);
  assert.match(cms, /!normalizeVideoUrl\(v\.url\)/);
  assert.match(instructor, /import \{ normalizeVideoUrl \} from "\/assets\/js\/utils\/video-url\.js"/);
  assert.match(instructor, /info\.type === "youtubePlaylist"/);
});

test("existing YouTube forms and the reported Live URL produce the same safe embed", async () => {
  const { normalizeVideoUrl } = await helper;
  const id = "RjSFJQ60zHg";
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `http://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?feature=share&v=${id}`,
    `https://youtu.be/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://youtube.com/live/${id}?feature=share`,
    `https://www.youtube.com/live/${id}`,
    id
  ]) {
    assert.deepEqual(normalizeVideoUrl(url), {
      type: "youtube",
      id,
      embedUrl: `https://www.youtube.com/embed/${id}`,
      watchUrl: `https://www.youtube.com/watch?v=${id}`
    }, url);
  }
});

test("untrusted hosts, invalid IDs, and unsafe URL schemes are rejected", async () => {
  const { normalizeVideoUrl } = await helper;
  for (const url of [
    "https://youtube.com.evil.test/live/RjSFJQ60zHg",
    "https://evil.test/youtube.com/watch?v=RjSFJQ60zHg",
    "https://www.youtube.com/live/short?feature=share",
    "https://www.youtube.com/embed/RjSFJQ60zHg/extra",
    "https://youtu.be/RjSFJQ60zHg<script>",
    "javascript:alert(1)//video.mp4",
    "data:video/mp4;base64,AAAA",
    "https://user@www.youtube.com/watch?v=RjSFJQ60zHg",
    "not a video URL"
  ]) {
    assert.equal(normalizeVideoUrl(url), null, url);
  }
});

test("existing direct MP4 course playback remains supported", async () => {
  const { normalizeVideoUrl } = await helper;
  assert.deepEqual(normalizeVideoUrl("https://cdn.example.test/class.mp4?token=abc"), {
    type: "mp4",
    url: "https://cdn.example.test/class.mp4?token=abc"
  });
});

test("YouTube playlists use the playlist embed and remain one course item", async () => {
  const { normalizeVideoUrl } = await helper;
  const list = "PLaT4Dc4NvTY0";
  assert.deepEqual(normalizeVideoUrl(`https://www.youtube.com/playlist?list=${list}`), {
    type: "youtubePlaylist",
    id: list,
    embedUrl: `https://www.youtube.com/embed/videoseries?list=${list}`,
    watchUrl: `https://www.youtube.com/playlist?list=${list}`
  });
  assert.equal(normalizeVideoUrl("https://www.youtube.com/watch?v=RjSFJQ60zHg&list=PLaT4Dc4NvTY0").type, "youtube");
  for (const bad of ["https://www.youtube.com/playlist?list=short", "https://www.youtube.com/playlist?list=", "https://youtube.com.evil.test/playlist?list=PLaT4Dc4NvTY0"]) {
    assert.equal(normalizeVideoUrl(bad), null);
  }
});
