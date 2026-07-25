export interface CaptchaProviderInfo {
  id: string;
  name: string;
  website: string;
}

export const CAPTCHA_PROVIDERS: CaptchaProviderInfo[] = [
  { id: "2captcha", name: "2Captcha", website: "https://2captcha.com" },
  { id: "capsolver", name: "CapSolver", website: "https://capsolver.com" },
  { id: "anticaptcha", name: "Anti-Captcha", website: "https://anti-captcha.com" },
  { id: "capmonstercloud", name: "CapMonster Cloud", website: "https://capmonster.cloud" },
  { id: "capmonsterselfhosted", name: "CapMonster Self-Hosted", website: "http://localhost:80" },
  { id: "deathbycaptcha", name: "DeathByCaptcha", website: "https://deathbycaptcha.com" },
  { id: "nopecha", name: "NopeCHA", website: "https://nopecha.com" },
  { id: "anycaptcha", name: "AnyCaptcha", website: "https://anycaptcha.com" },
  { id: "azcaptcha", name: "AZcaptcha", website: "https://azcaptcha.com" },
  { id: "imagetyperz", name: "ImageTyperz", website: "https://imagetyperz.com" },
  { id: "solvecaptcha", name: "SolveCaptcha", website: "https://solvecaptcha.com" },
  { id: "bestcaptchasolver", name: "BestCaptchaSolver", website: "https://bestcaptchasolver.com" },
  { id: "ocrspace", name: "OCR.Space", website: "https://ocr.space" },
  { id: "ai4cap", name: "AI4CAP", website: "https://ai4cap.com" },
  { id: "captchaai", name: "CaptchaAI", website: "https://captchaai.com" },
  { id: "capguru", name: "Cap.guru", website: "https://cap.guru" },
  { id: "rucaptcha", name: "RuCaptcha", website: "https://rucaptcha.com" },
  { id: "endcaptcha", name: "EndCaptcha", website: "https://endcaptcha.com" },
  { id: "bypasscaptcha", name: "BypassCaptcha", website: "https://bypasscaptcha.com" },
  { id: "expertdecoders", name: "ExpertDecoders", website: "https://expertdecoders.com" },
  { id: "pixodrom", name: "Pixodrom", website: "https://pixodrom.com" },
  { id: "cheapcaptcha", name: "CheapCaptcha", website: "https://cheapcaptcha.com" },
  { id: "captchatronix", name: "CaptchaTronix", website: "https://captchatronix.com" },
  { id: "captchasolutions", name: "CaptchaSolutions", website: "https://captchasolutions.com" },
  { id: "xevil", name: "XEvil (self-hosted)", website: "http://localhost:80" },
  { id: "ocrsdk", name: "OCR SDK (ABBYY)", website: "https://www.ocr-sdk.com" },
  { id: "tesseract", name: "Tesseract OCR", website: "https://github.com/tesseract-ocr/tesseract" },
  { id: "googlecloudvision", name: "Google Cloud Vision OCR", website: "https://cloud.google.com/vision" },
  { id: "azureaivision", name: "Microsoft Azure AI Vision", website: "https://azure.microsoft.com/en-us/products/ai-services/ai-vision" },
  { id: "amazontextract", name: "Amazon Textract", website: "https://aws.amazon.com/textract" },
  { id: "bytescout", name: "ByteScout Cloud OCR", website: "https://bytescout.com" },
  { id: "nanonets", name: "Nanonets OCR", website: "https://nanonets.com" },
  { id: "mindee", name: "Mindee OCR", website: "https://mindee.com" },
  { id: "veryfi", name: "Veryfi OCR", website: "https://veryfi.com" },
  { id: "mock", name: "Mock Solver", website: "https://github.com/khushang-2326/SDI" }
];
