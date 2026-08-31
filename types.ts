
export interface TechStackInfo {
  cms?: string;
  theme?: string;
  hosting?: string;
  domainRegistrar?: string;
  frontendFrameworks?: string[];
  analytics?: string[];
  marketingScripts?: string[];
  plugins?: string[];
  otherTech?: string[];
  securityHeaders?: string[];
  networkForensics?: string[];
  behavioralIndicators?: string[];
  summary?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface AnalysisResult {
  url: string;
  techStack: TechStackInfo;
  sources: GroundingSource[];
  rawText: string;
}
