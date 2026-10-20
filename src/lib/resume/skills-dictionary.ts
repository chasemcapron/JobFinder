/**
 * Common skills recognized by the offline (no-API-key) resume analyzer.
 * Ambiguous single words (e.g. "Go", "R", "C") are omitted to avoid false positives.
 */
export const KNOWN_SKILLS = [
  // Languages
  "JavaScript", "TypeScript", "Python", "Java", "Kotlin", "Swift", "Objective-C", "C++", "C#", "Golang", "Rust",
  "Ruby", "PHP", "Scala", "Elixir", "Haskell", "Clojure", "Perl", "MATLAB", "SQL", "Bash", "PowerShell", "Dart",
  "Lua", "Julia", "Solidity", "VBA", "SAS", "Stata", "Fortran", "COBOL",
  // Web / frontend
  "React", "Next.js", "Vue", "Angular", "Svelte", "Redux", "HTML", "CSS", "Tailwind", "Sass", "jQuery", "Webpack",
  "Vite", "GraphQL", "REST", "gRPC", "WebSockets", "React Native", "Flutter",
  // Backend / frameworks
  "Node.js", "Express", "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Rails", "Ruby on Rails", "Laravel",
  ".NET", "ASP.NET", "Microservices",
  // Data / ML
  "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "PyTorch", "TensorFlow", "scikit-learn", "Pandas",
  "NumPy", "Spark", "Hadoop", "Airflow", "dbt", "Kafka", "Snowflake", "BigQuery", "Redshift", "Databricks", "Tableau",
  "Power BI", "Looker", "Excel", "ETL", "Data Modeling", "Statistics", "A/B Testing", "LLM", "Generative AI",
  // Databases
  "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Elasticsearch", "DynamoDB", "Cassandra", "Oracle",
  "SQL Server",
  // Cloud / devops
  "AWS", "Azure", "GCP", "Google Cloud", "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins", "GitHub Actions",
  "CI/CD", "Linux", "Serverless", "Lambda", "CloudFormation", "Prometheus", "Grafana", "Datadog", "Nginx",
  // Security: tools, practices, frameworks and certifications (so a security resume still yields
  // skills when the AI is unavailable)
  "Cybersecurity", "Information Security", "Network Security", "Cloud Security", "SIEM", "Splunk", "Microsoft Sentinel",
  "QRadar", "SOAR", "EDR", "XDR", "CrowdStrike", "Microsoft Defender", "SentinelOne", "Carbon Black", "IDS/IPS",
  "Snort", "Suricata", "Zeek", "Wireshark", "tcpdump", "Nmap", "Metasploit", "Burp Suite", "Nessus", "Qualys",
  "Tenable", "OpenVAS", "Kali Linux", "Active Directory", "Entra ID", "Azure AD", "Okta", "IAM", "MFA", "PKI",
  "Firewalls", "Palo Alto Networks", "Fortinet", "VPN", "TCP/IP", "DNS", "Incident Response", "Threat Hunting",
  "Threat Intelligence", "Vulnerability Management", "Penetration Testing", "Digital Forensics", "Malware Analysis",
  "Log Analysis", "MITRE ATT&CK", "NIST CSF", "NIST 800-53", "ISO 27001", "SOC 2", "PCI DSS", "HIPAA",
  "CIS Controls", "Risk Assessment", "GRC", "Security+", "CySA+", "Network+", "CEH", "CISSP", "CISM", "CISA", "GSEC",
  "OSCP", "CCNA",
  // Practices / tools
  "Git", "Agile", "Scrum", "Jira", "TDD", "System Design", "Distributed Systems", "Security", "OAuth",
  "Figma", "UX Research", "Product Management", "Project Management", "Salesforce", "SAP", "Six Sigma",
  "Accounting", "Financial Modeling", "Marketing", "SEO", "Copywriting", "Customer Success", "Sales",
] as const;

/** Title stems used to find likely job titles in resume lines. */
export const TITLE_HINTS = [
  "engineer", "developer", "programmer", "architect", "scientist", "analyst", "designer", "manager", "director",
  "consultant", "specialist", "administrator", "technician", "coordinator", "lead", "researcher", "accountant",
  "associate", "intern", "strategist", "officer", "writer", "marketer", "recruiter",
] as const;
