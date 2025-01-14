import {
  CreateBranchtagUrls,
  CreateRepoUrl,
  DenoModule,
  FetchModuleBranchtags,
  FetchModuleMetadata,
  GitHubTreeFile,
  TransformBranchtags,
  TreeFile,
} from "@/types";

import { fetchModule } from "@/services/registry";
import { getGitHubHeaders } from "@/services/github";

export const createRepoUrl: CreateRepoUrl = ({ type, org, repo }) => {
  switch (type) {
    case "GitHub":
      return `https://github.com/${org}/${repo}`;
    case "GitLab":
      return `https://gitlab.com/${org}/${repo}`;
    default:
      throw new Error("invalid module type");
  }
};

export const createBranchtagUrls: CreateBranchtagUrls = ({
  type,
  org,
  repo,
}) => {
  switch (type) {
    case "GitHub":
      return [
        `https://api.github.com/repos/${org}/${repo}/branches`,
        `https://api.github.com/repos/${org}/${repo}/tags`,
      ];
    case "GitLab":
      return [`https://gitlab.com/${org}/${repo}/refs`];
    default:
      throw new Error("invalid module type");
  }
};

export const transformBranchtags: TransformBranchtags = ({ data, type }) => {
  switch (type) {
    case "GitHub":
      return (data as any[]).map(({ name }) => name);
    case "GitLab":
      return [...data.Branches, ...data.Tags];
    default:
      throw new Error("invalid module type");
  }
};

export const fetchModuleBranchtags: FetchModuleBranchtags = async ({
  type,
  org,
  repo,
}) => {
  const refs: string[] = [];
  const urls = createBranchtagUrls({ type, org, repo });

  let headers: Headers;
  if (type === "GitHub") {
    headers = new Headers(getGitHubHeaders());
  }

  let data: any;
  for (const url of urls) {
    data = await fetch(url, { headers }).then((resp) => resp.json());
    refs.push(...transformBranchtags({ data, type }));
  }
  return refs;
};

export const fetchModuleMetadata: FetchModuleMetadata = async ({
  segments,
  isApi = false,
} = {}) => {
  const captured = /([0-9a-z-_]+)(?:@(.+))?/.exec(segments[0]);
  let [, moduleName, branchtag = null] = captured;

  const module = await fetchModule(moduleName);

  if (module) {
    const meta: DenoModule = {
      name: moduleName,
      ...module,
      repoUrl: createRepoUrl(module),
    };

    let headers: Headers;
    if (meta.type === "GitHub") {
      headers = getGitHubHeaders();
    } else if (meta.type === "GitLab") {
      // TODO: implement gitlab request headers
    }

    if (!branchtag) {
      if (meta.type === "GitHub") {
        const branchtagUrl = `https://api.github.com/repos/${meta.org}/${meta.repo}`;
        const resp = await fetch(branchtagUrl, { headers });
        const data = await resp.json();
        branchtag = data.default_branch;
      } else if (meta.type === "GitLab") {
        // TODO: implement gitlab branchtag fetching
      } else {
        branchtag = "master";
      }
    }

    let branchtags: string[] = null;
    let breadcrumbs: string[][] = null;

    if (!isApi) {
      branchtags = await fetchModuleBranchtags(meta);

      const sx = ["x", ...segments];
      breadcrumbs = sx.map((_, i) => [
        sx[i],
        `/${sx.slice(0, i + 1).join("/")}`,
      ]);
    }

    const path = `/${segments.slice(1).join("/")}`;

    let tree: TreeFile | TreeFile[] = null;
    let errors: any = null;

    if (meta.type === "GitHub") {
      const treeUrl = `https://api.github.com/repos/${meta.org}/${meta.repo}/contents${path}?ref=${branchtag}`;
      const resp = await fetch(treeUrl, { headers });
      if (resp.ok) {
        tree = await resp.json();
      } else {
        errors = await resp.json();
      }
    } else if (meta.type === "GitLab") {
      const treeUrl = `https://gitlab.com/${meta.org}/${meta.repo}/-/refs/${branchtag}/logs_tree/?format=json`;
      // TODO: implement gitlab tree fetching
    } else {
      // TODO: implement tree fallback action
    }

    let content: string = null;
    let readme: string = null;
    let sourceUrl: string = null;

    if (tree) {
      if (Array.isArray(tree)) {
        tree = tree.sort((a, b) => a.type.localeCompare(b.type));

        if (meta.type === "GitHub") {
          let file = tree.find(
            (t) => t.name.toLowerCase() === "readme.md",
          ) as GitHubTreeFile;

          if (file) {
            const resp = await fetch(file.download_url);
            readme = await resp.text();
          }
        } else if (meta.type === "GitLab") {
          // TODO: implement gitlab readme fetching
        } else {
          // TODO: implement file fallback action
        }
      } else {
        if (meta.type === "GitHub") {
          const file = tree as GitHubTreeFile;
          content = file.encoding
            ? Buffer.from(file.content, file.encoding).toString()
            : file.content;
          sourceUrl = file.download_url;
        } else if (meta.type === "GitLab") {
          // TODO: implement gitlab file fetching
        } else {
          // TODO: implement file fallback action
        }
      }
    }

    return {
      meta,
      branchtag,
      branchtags,
      segments,
      breadcrumbs,
      path,
      tree,
      readme,
      content,
      sourceUrl,
      errors,
    };
  }

  return { segments };
};

export const getContentType = (name: string) => {
  switch (/.+\.(.+)$/.exec(name)[1]) {
    case "js":
      return "application/javascript";
    case "ts":
      return "application/typescript";
    default:
      return "text/plain";
  }
};

export const isImageFromName = (name: string) => {
  const exts = ["gif", "jpg", "jpeg", "png", "svg"];

  for (const ext of exts) {
    if (name.endsWith(`.${ext}`)) {
      return true;
    }
  }

  return false;
};
