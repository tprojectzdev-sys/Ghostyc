// `screenshot` — captures the primary monitor as JPEG. PROTOCOL.md §13.1.
//
// V1 constraints (per spec):
//   * primary monitor only
//   * JPEG only, base64 inline (no streaming, no separate upload endpoint)
//   * default max_dimension = 1920, clamp [320, 3840]
//   * default quality = 80, clamp [40, 95]
//   * hard 1.5 MB cap on encoded bytes; on overflow we step quality down by 20
//     and re-encode, never below 40. If still over, return command.image_too_large.
//
// Uses PowerShell + System.Drawing (built into Windows, no native deps).

import { z } from "zod";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runPowerShell } from "./helpers/powershell.js";

const MIN_QUALITY = 40;
const QUALITY_STEP = 20;
const HARD_BYTES_CAP = 1_572_864; // 1.5 MB

const ArgsSchema = z.object({
  max_dimension: z.number().int().min(320).max(3840).default(1920),
  quality: z.number().int().min(40).max(95).default(80),
  format: z.literal("jpeg").default("jpeg"),
});

interface CaptureMeta {
  width: number;
  height: number;
  bytes: number;
}

const PS_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][int]$MaxDim,
  [Parameter(Mandatory=$true)][int]$Quality,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$capW = $bounds.Width
$capH = $bounds.Height
$bmp = New-Object System.Drawing.Bitmap $capW, $capH
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(([System.Drawing.Point]::new($bounds.X, $bounds.Y)), ([System.Drawing.Point]::new(0,0)), ([System.Drawing.Size]::new($capW, $capH)))
$g.Dispose()

$longer = [Math]::Max($capW, $capH)
$finalW = $capW
$finalH = $capH
if ($longer -gt $MaxDim) {
  $scale = $MaxDim / $longer
  $finalW = [int][Math]::Round($capW * $scale)
  $finalH = [int][Math]::Round($capH * $scale)
  $resized = New-Object System.Drawing.Bitmap $finalW, $finalH
  $rg = [System.Drawing.Graphics]::FromImage($resized)
  $rg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $rg.DrawImage($bmp, 0, 0, $finalW, $finalH)
  $rg.Dispose()
  $bmp.Dispose()
  $bmp = $resized
}

$jpegEncoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$encParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
$bmp.Save($OutputPath, $jpegEncoder, $encParams)
$bmp.Dispose()

$file = Get-Item $OutputPath
@{ width = $finalW; height = $finalH; bytes = $file.Length } | ConvertTo-Json -Compress
`;

export async function runScreenshot(rawArgs: Record<string, unknown>) {
  const parsed = ArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new Error(
      `invalid args: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  const { max_dimension, quality: requestedQuality, format } = parsed.data;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ghostyc-shot-"));
  const outPath = path.join(tmpDir, "shot.jpg");

  let quality = requestedQuality;
  let meta: CaptureMeta | null = null;

  try {
    while (true) {
      // We use a wrapper script so we can pass parameters via -File (the helper
      // we built earlier sends script-as-file). PowerShell reads -File args.
      // Easiest cross-cutting solution: emit a wrapper script that calls our
      // logic with these specific args.
      const wrapper = `
$ErrorActionPreference = 'Stop'
& {
${PS_SCRIPT}
} -MaxDim ${max_dimension} -Quality ${quality} -OutputPath '${outPath.replace(/'/g, "''")}'
`;
      const result = await runPowerShell(wrapper, { timeout_ms: 14_000 });
      if (result.exit_code !== 0 && result.exit_code !== null) {
        const stderr = result.stderr.trim();
        // Windows Defender / AMSI aggressively flags PowerShell scripts that
        // call System.Drawing.Graphics.CopyFromScreen because info-stealer
        // malware uses the same API. This trips on legitimate use too. Per
        // PROTOCOL §13.1 we surface this as command.not_implemented with a
        // remediation hint, rather than faking a result or silently bypassing
        // an AV protection on the user's own PC.
        if (/malicious content|amsi|blocked by your antivirus/i.test(stderr)) {
          const err = new Error(
            "Windows Defender / AMSI blocked the screenshot script. " +
              "This is a known pattern detection on PowerShell screen-capture. " +
              "Remediation: either add the agent's logs/temp script directory to Defender exclusions, " +
              "or wait for the V2 native screenshot helper. Phase 2 does not bypass AV.",
          );
          (err as Error & { code: string }).code = "command.not_implemented";
          throw err;
        }
        throw new Error(
          `screenshot capture failed (exit=${result.exit_code}): ${stderr || "no stderr"}`,
        );
      }
      const trimmed = result.stdout.trim();
      try {
        meta = JSON.parse(trimmed) as CaptureMeta;
      } catch {
        throw new Error(`screenshot script produced unparseable output: ${trimmed.slice(0, 200)}`);
      }
      if (meta.bytes <= HARD_BYTES_CAP) break;

      const nextQuality = quality - QUALITY_STEP;
      if (nextQuality < MIN_QUALITY) {
        const err = new Error(
          `encoded image is ${meta.bytes} bytes (cap ${HARD_BYTES_CAP}) even at quality ${quality}; refusing to fake or truncate`,
        );
        (err as Error & { code: string }).code = "command.image_too_large";
        throw err;
      }
      quality = nextQuality;
    }

    if (!meta) {
      throw new Error("internal: meta is null after capture loop");
    }

    const bytes = fs.readFileSync(outPath);
    const image_b64 = bytes.toString("base64");
    return {
      image_b64,
      mime: "image/jpeg" as const,
      format,
      width: meta.width,
      height: meta.height,
      bytes: meta.bytes,
      max_dimension,
      quality,
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
