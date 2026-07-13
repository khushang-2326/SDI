export type WebsiteImportSummary = {
  totalRows: number;
  savedRows: number;
  duplicateRows: number;
  invalidRows: number;
  failedRows: number;
  message?: string;
};

export type WebsiteImportRow = {
  websiteName: string;
  websiteUrl: string;
  contactPageUrl: string;
  status: string;
  notes: string | null;
};
