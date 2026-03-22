import { describe, expect, it } from "vitest";
import { createLibraryAdapterRegistry, extractSourceImports } from "../src/canvas/library-adapters/registry";

type ImportFixture = {
  name: string;
  adapterId: string;
  sourceText: string;
  componentName: string;
  expectedSource: string;
};

const IMPORT_FIXTURES: ImportFixture[] = [
  {
    name: "shadcn-button-import",
    adapterId: "builtin:react/shadcn-ui",
    sourceText: "import { Button } from '@/components/ui/button';\nexport function Demo() { return <Button />; }\n",
    componentName: "Button",
    expectedSource: "@/components/ui/button"
  },
  {
    name: "lucide-alarm-import",
    adapterId: "builtin:react/lucide-react",
    sourceText: "import { AlarmClock } from 'lucide-react';\nexport function Demo() { return <AlarmClock />; }\n",
    componentName: "AlarmClock",
    expectedSource: "lucide-react"
  },
  {
    name: "framer-motion-import",
    adapterId: "builtin:react/framer-motion",
    sourceText: "import { motion } from 'framer-motion';\nexport function Demo() { return <motion.div />; }\n",
    componentName: "motion",
    expectedSource: "framer-motion"
  },
  {
    name: "radix-slot-import",
    adapterId: "builtin:react/radix-ui",
    sourceText: "import { Slot } from '@radix-ui/react-slot';\nexport function Demo() { return <Slot />; }\n",
    componentName: "Slot",
    expectedSource: "@radix-ui/react-slot"
  },
  {
    name: "tabler-icons-import",
    adapterId: "builtin:react/tabler-icons",
    sourceText: "import { IconAirBalloon } from '@tabler/icons-react';\nexport function Demo() { return <IconAirBalloon />; }\n",
    componentName: "IconAirBalloon",
    expectedSource: "@tabler/icons-react"
  },
  {
    name: "fluent-icons-import",
    adapterId: "builtin:react/fluent-icons",
    sourceText: "import { AccessTimeFilled } from '@fluentui/react-icons';\nexport function Demo() { return <AccessTimeFilled />; }\n",
    componentName: "AccessTimeFilled",
    expectedSource: "@fluentui/react-icons"
  },
  {
    name: "heroicons-import",
    adapterId: "builtin:react/heroicons",
    sourceText: "import { BeakerIcon } from '@heroicons/react/24/solid';\nexport function Demo() { return <BeakerIcon />; }\n",
    componentName: "BeakerIcon",
    expectedSource: "@heroicons/react/24/solid"
  },
  {
    name: "mui-button-import",
    adapterId: "builtin:react/mui",
    sourceText: "import { Button } from '@mui/material';\nexport function Demo() { return <Button />; }\n",
    componentName: "Button",
    expectedSource: "@mui/material"
  },
  {
    name: "chakra-box-import",
    adapterId: "builtin:react/chakra-ui",
    sourceText: "import { Box } from '@chakra-ui/react';\nexport function Demo() { return <Box />; }\n",
    componentName: "Box",
    expectedSource: "@chakra-ui/react"
  },
  {
    name: "antd-button-import",
    adapterId: "builtin:react/antd",
    sourceText: "import { Button } from 'antd';\nexport function Demo() { return <Button />; }\n",
    componentName: "Button",
    expectedSource: "antd"
  }
];

describe("canvas library adapters", () => {
  it("parses namespace, default, aliased, and side-effect imports while handling registry misses", () => {
    const sourceText = [
      "import Button from 'antd';",
      "import * as motion from 'framer-motion';",
      "import { AlarmClock as Alarm } from 'lucide-react';",
      "import '@/app.css';"
    ].join("\n");
    const imports = extractSourceImports(sourceText);
    const registry = createLibraryAdapterRegistry();

    expect(imports).toEqual([
      {
        source: "antd",
        specifiers: [],
        defaultImport: "Button"
      },
      {
        source: "framer-motion",
        specifiers: [],
        namespaceImport: "motion"
      },
      {
        source: "lucide-react",
        specifiers: ["Alarm"]
      },
      {
        source: "@/app.css",
        specifiers: []
      }
    ]);
    expect(registry.get("missing")).toBeNull();
    expect(() => registry.register(registry.get("builtin:react/antd")!)).toThrow("duplicate_adapter_id:builtin:react/antd");
    expect(registry.resolveForSource({
      frameworkId: "react",
      sourceText,
      imports
    }).map((entry) => entry.id)).toEqual([
      "builtin:react/lucide-react",
      "builtin:react/framer-motion",
      "builtin:react/antd"
    ]);
    expect(registry.resolveForSource({
      frameworkId: "vue",
      sourceText,
      imports
    })).toEqual([]);
  });

  it("covers the intrinsic html library lane", () => {
    const registry = createLibraryAdapterRegistry();
    const adapter = registry.get("builtin:react/html-intrinsic");

    expect(adapter).toBeTruthy();
    expect(adapter!.matchesSourceNode({
      frameworkId: "react",
      sourceText: "<section />",
      imports: [],
      tagName: "section"
    })).toBe(true);
    expect(adapter!.buildInventoryItem({
      frameworkId: "react",
      sourceText: "<section />",
      imports: [],
      tagName: "section"
    })).toMatchObject({
      componentName: "section",
      metadata: {
        libraryAdapterId: "builtin:react/html-intrinsic"
      }
    });
    expect(adapter!.buildProjectionDescriptor({
      frameworkId: "react",
      sourceText: "<section />",
      imports: [],
      tagName: "section"
    })).toMatchObject({
      attributes: {
        "data-library-adapter": "builtin:react/html-intrinsic",
        "data-html-tag": "section"
      }
    });
  });

  it("covers intrinsic and package adapter false-path branches", () => {
    const registry = createLibraryAdapterRegistry();
    const intrinsicAdapter = registry.get("builtin:react/html-intrinsic")!;
    const antdAdapter = registry.get("builtin:react/antd")!;
    const motionAdapter = registry.get("builtin:react/framer-motion")!;
    const defaultImports = extractSourceImports("import Button from 'antd';");
    const namespaceImports = extractSourceImports("import * as motion from 'framer-motion';");

    expect(intrinsicAdapter.matchesSourceNode({
      frameworkId: "react",
      sourceText: "<Section />",
      imports: [],
      tagName: "Section"
    })).toBe(false);
    expect(intrinsicAdapter.buildInventoryItem({
      frameworkId: "react",
      sourceText: "<div />",
      imports: [],
      tagName: null
    })).toBeNull();
    expect(intrinsicAdapter.buildProjectionDescriptor({
      frameworkId: "react",
      sourceText: "<div />",
      imports: [],
      tagName: null
    })).toBeNull();

    expect(antdAdapter.matchesSourceNode({
      frameworkId: "react",
      sourceText: "import Button from 'antd';",
      imports: defaultImports,
      componentName: "Button"
    })).toBe(true);
    expect(antdAdapter.matchesSourceNode({
      frameworkId: "react",
      sourceText: "import Button from 'antd';",
      imports: [],
      componentName: "Button"
    })).toBe(false);
    expect(antdAdapter.matchesSourceNode({
      frameworkId: "react",
      sourceText: "import Button from 'antd';",
      imports: defaultImports,
      componentName: ""
    })).toBe(false);
    expect(antdAdapter.matchesSourceNode({
      frameworkId: "react",
      sourceText: "import Button from 'antd';",
      imports: defaultImports
    })).toBe(false);
    expect(antdAdapter.buildInventoryItem({
      frameworkId: "react",
      sourceText: "import Button from 'antd';",
      imports: defaultImports,
      componentName: null
    })).toBeNull();
    expect(antdAdapter.buildProjectionDescriptor({
      frameworkId: "react",
      sourceText: "import Button from 'antd';",
      imports: [],
      componentName: "Button"
    })).toBeNull();
    expect(antdAdapter.fallbackReason({
      frameworkId: "react",
      sourceText: "import Button from 'antd';",
      imports: defaultImports,
      componentName: "Button"
    })).toBe("Button");
    expect(antdAdapter.emitSourceFragment()).toBeNull();
    expect(antdAdapter.extractVariantInfo()).toEqual([]);
    expect(antdAdapter.extractTokenBindings()).toEqual([]);

    expect(motionAdapter.matchesSourceNode({
      frameworkId: "react",
      sourceText: "import * as motion from 'framer-motion';",
      imports: namespaceImports,
      componentName: "motion"
    })).toBe(true);
    expect(motionAdapter.buildProjectionDescriptor({
      frameworkId: "react",
      sourceText: "import * as motion from 'framer-motion';",
      imports: namespaceImports,
      componentName: "motion"
    })).toMatchObject({
      attributes: {
        "data-library-adapter": "builtin:react/framer-motion",
        "data-library-source": "framer-motion"
      }
    });
  });

  it("parses empty named imports and covers package adapter fallback null branches", () => {
    const sourceText = [
      "import DefaultButton, {} from 'antd';",
      "import { } from '@mui/material';",
      "import { Card as MarketingCard } from '@/components/ui/card';"
    ].join("\n");
    const imports = extractSourceImports(sourceText);
    const registry = createLibraryAdapterRegistry();
    const shadcnAdapter = registry.get("builtin:react/shadcn-ui");

    expect(imports).toEqual([
      {
        source: "antd",
        specifiers: [],
        defaultImport: "DefaultButton,"
      },
      {
        source: "@mui/material",
        specifiers: []
      },
      {
        source: "@/components/ui/card",
        specifiers: ["MarketingCard"]
      }
    ]);
    expect(shadcnAdapter).toBeTruthy();
    expect(shadcnAdapter?.buildProjectionDescriptor({
      frameworkId: "react",
      sourceText,
      imports: [],
      componentName: "Card"
    })).toBeNull();
    expect(shadcnAdapter?.fallbackReason({
      frameworkId: "react",
      sourceText,
      imports,
      componentName: null,
      tagName: null
    })).toBeNull();
  });

  it.each(IMPORT_FIXTURES)("covers the $name named fixture", ({ adapterId, sourceText, componentName, expectedSource }) => {
    const registry = createLibraryAdapterRegistry();
    const imports = extractSourceImports(sourceText);
    const resolved = registry.resolveForSource({
      frameworkId: "react",
      sourceText,
      imports
    });
    const adapter = registry.get(adapterId);

    expect(adapter).toBeTruthy();
    expect(resolved.map((entry) => entry.id)).toContain(adapterId);
    expect(adapter!.matchesSourceNode({
      frameworkId: "react",
      sourceText,
      imports,
      componentName
    })).toBe(true);
    expect(adapter!.buildInventoryItem({
      frameworkId: "react",
      sourceText,
      imports,
      componentName
    })).toMatchObject({
      metadata: {
        libraryAdapterId: adapterId
      }
    });
    expect(adapter!.buildProjectionDescriptor({
      frameworkId: "react",
      sourceText,
      imports,
      componentName
    })).toMatchObject({
      attributes: {
        "data-library-adapter": adapterId,
        "data-library-source": expectedSource
      },
      metadata: {
        source: expectedSource
      }
    });
  });

  it("handles blank import clauses, tag-name fallback matching, and intrinsic fallback reasons", () => {
    const sourceText = [
      "import  from 'broken-package';",
      "import DialogRoot from '@radix-ui/react-dialog';"
    ].join("\n");
    const imports = extractSourceImports(sourceText);
    const registry = createLibraryAdapterRegistry();
    const radixAdapter = registry.get("builtin:react/radix-ui")!;
    const intrinsicAdapter = registry.get("builtin:react/html-intrinsic")!;

    expect(imports).toEqual([
      {
        source: "broken-package",
        specifiers: []
      },
      {
        source: "@radix-ui/react-dialog",
        specifiers: [],
        defaultImport: "DialogRoot"
      }
    ]);
    expect(radixAdapter.matchesSourceNode({
      frameworkId: "react",
      sourceText,
      imports,
      componentName: null,
      tagName: "DialogRoot"
    })).toBe(true);
    expect(radixAdapter.fallbackReason({
      frameworkId: "react",
      sourceText,
      imports,
      componentName: null,
      tagName: "DialogRoot"
    })).toBe("DialogRoot");
    expect(intrinsicAdapter.fallbackReason({
      frameworkId: "react",
      sourceText,
      imports: [],
      componentName: null,
      tagName: "section"
    })).toBe("section");
    expect(intrinsicAdapter.fallbackReason({
      frameworkId: "react",
      sourceText,
      imports: [],
      componentName: null,
      tagName: null
    })).toBeNull();
    expect(intrinsicAdapter.emitSourceFragment()).toBeNull();
    expect(intrinsicAdapter.extractVariantInfo()).toEqual([]);
    expect(intrinsicAdapter.extractTokenBindings()).toEqual([]);
  });

  it("covers whitespace-only, named-only, and type-only import clauses", () => {
    const imports = extractSourceImports([
      "import   from 'blank-clause';",
      "import { Button, Card as MarketingCard } from '@mui/material';",
      "import type { Slot } from '@radix-ui/react-slot';",
      "import '@/styles.css';"
    ].join("\n"));

    expect(imports).toEqual([
      {
        source: "blank-clause",
        specifiers: []
      },
      {
        source: "@mui/material",
        specifiers: ["Button", "MarketingCard"]
      },
      {
        source: "@radix-ui/react-slot",
        specifiers: ["Slot"]
      },
      {
        source: "@/styles.css",
        specifiers: []
      }
    ]);
  });

  it("covers malformed named imports and ignores non-import adapters during source resolution", () => {
    const registry = createLibraryAdapterRegistry();
    registry.register({
      id: "custom:tag-only",
      frameworkId: "react",
      kind: "test",
      resolutionStrategy: "tag",
      capabilities: [],
      sourceLocatorSchema: "tag-name",
      matchesSourceNode: () => false,
      buildInventoryItem: () => null,
      buildProjectionDescriptor: () => null,
      emitSourceFragment: () => null,
      extractVariantInfo: () => [],
      extractTokenBindings: () => [],
      fallbackReason: () => null
    });

    const imports = extractSourceImports([
      "import { Chip } from '@mui/material';",
      "import { Foo as } from 'broken-alias';",
      "import { Divider from 'broken-brace';"
    ].join("\n"));

    expect(imports).toEqual([
      {
        source: "@mui/material",
        specifiers: ["Chip"]
      },
      {
        source: "broken-alias",
        specifiers: ["Foo as"]
      },
      {
        source: "broken-brace",
        specifiers: ["Divider"]
      }
    ]);
    expect(registry.resolveForSource({
      frameworkId: "react",
      sourceText: "import { Chip } from '@mui/material';",
      imports
    }).map((entry) => entry.id)).toContain("builtin:react/mui");
    expect(registry.resolveForSource({
      frameworkId: "react",
      sourceText: "import { Chip } from '@mui/material';",
      imports
    }).map((entry) => entry.id)).not.toContain("custom:tag-only");
  });

  it("skips blank import sources while preserving valid namespace imports", () => {
    const imports = extractSourceImports([
      "import * as icons from 'lucide-react';",
      "import {} from '   ';"
    ].join("\n"));

    expect(imports).toEqual([
      {
        source: "lucide-react",
        specifiers: [],
        namespaceImport: "icons"
      }
    ]);
  });
});
