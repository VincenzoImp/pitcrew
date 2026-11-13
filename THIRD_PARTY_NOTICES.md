# Third-party notices

pitcrew is the owner's work under the repo's MIT licence, except the parts listed in section 1.
Those parts copy or closely adapt text or code from other projects; their licences apply to them.
Section 2 lists projects that shaped the design with no text copied. This is the only place where
the harness records where its text comes from: skills, rules, docs and code do not.

## 1. Copied or closely adapted

| Source | Commit | Licence | Copyright | Paths in this repo | How |
| --- | --- | --- | --- | --- | --- |
| [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) | `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` | MIT | Copyright (c) 2025-2026 Cloudflare, Inc. | `skills/security-audit/references/classes/*.md`; `skills/security-audit/scripts/report-schema.json`; `skills/security-audit/SKILL.md`, `references/recon.md`, `references/hunting.md`, `references/validation.md` | the attack-class files: copied, wording changes only; the schema: copied, only its `$comment` changed; the skill and the phase files: adapted, with copied passages |
| [mattpocock/skills](https://github.com/mattpocock/skills) | `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` | MIT | Copyright (c) 2026 Matt Pocock | `skills/diagnosing-bugs/SKILL.md`, `scripts/hitl-loop.template.sh`; `skills/tdd/SKILL.md`, `references/tests.md`, `references/mocking.md`; `skills/codebase-design/**`; `skills/prototype/**`; `skills/work-planning/SKILL.md` (with its questioning section), `references/decision-map.md`, `references/spec.md`; `skills/writing-for-agents/SKILL.md`, `references/mechanics.md`; `skills/code-review/references/finders.md` (the smell baseline) | adapted; the loop script, the test and mock examples, the prototype switcher code and the smell baseline are close copies |
| [nicobailon/grill-for-unknowns](https://github.com/nicobailon/grill-for-unknowns) | `d8d5f4b422b8be1301dd4a515d96589eaddc5f3c` | MIT | Copyright (c) 2026 Matt Pocock; Copyright (c) 2026 Nico Bailon | `skills/work-planning/SKILL.md`, `references/blindspot-pass.md`, `references/ledger.md` | adapted |
| [nicobailon/skill-diet](https://github.com/nicobailon/skill-diet) | `b93e14766ef327e2ff1b1d44f93027fb654e880b` | MIT | Copyright (c) 2026 Nico Bailon | `skills/writing-for-agents/references/diet.md` (close copy); `skills/writing-for-agents/SKILL.md`, `references/testing.md` | adapted |
| [dietrichgebert/ponytail](https://github.com/dietrichgebert/ponytail) | `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846` | MIT | Copyright (c) 2026 DietrichGebert | `AGENTS.global.md`, section "The smallest complete change" (close copy); `skills/code-review/SKILL.md`, `references/finders.md` (the lean checks and the finding format) | adapted |
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | `301b02b12bff98e4688e6984af6556802322bbde` | MIT | Copyright (c) 2025 Addy Osmani | `skills/frontend-design/SKILL.md`, `references/accessibility.md` (HTML samples copied); `skills/code-review/references/finders.md`; `skills/tdd/SKILL.md`; `skills/diagnosing-bugs/SKILL.md`; `skills/browser-check/SKILL.md` | adapted |
| [earendil-works/pi](https://github.com/earendil-works/pi) (`examples/extensions/`) | tag `v1.5.2` (`b4afdddf44e059c67ccf5097e5317d913521b470`) | MIT | Copyright (c) 2025 Mario Zechner | `extensions/agent/ask-user.ts` (from `questionnaire.ts`); the child process handling in `extensions/agent/` and the one-line child views in `extensions/agent/render.ts` (from `subagent/`); the branch-reading helpers in `extensions/handoff/index.ts` (from `handoff.ts`) | ported code |
| [google/elephant-goldfish-model](https://github.com/google/elephant-goldfish-model) | `8f168124593f26ce4125361f5e3ec9a073ebf174` | Apache-2.0 | no copyright line in the source; no NOTICE file | `skills/spec-review/references/personas.md` (from `agents/*.md`); `skills/spec-review/references/standards.md` (from `resources/document_standards/`); `skills/spec-review/SKILL.md` (the review loop and the resolution rules) | modified in 2026, see below |

### Changes to the Apache-2.0 material

The `spec-review` files above were modified in 2026 for this harness, and the two reference files
say so in one line (Apache-2.0 section 4(b)). The text is rewritten in Simple Technical English for
this harness's `agent` tool and roles. Seven personas from eight: `structural` is folded into
`readiness`, and `inventive_catalyst` is renamed `alternatives`. The panel is scaled by plan size
and by the rigor dial. Convergence and caps are changed. The brainstorm mode, the synthesizer, the
interactive gates and the per-stage report files are left out.

## 2. References (ideas only, no text or code copied)

- [earendil-works/pi-review](https://github.com/earendil-works/pi-review) (MIT): review targets and checks, for `code-review`.
- [nicobailon/pi-design-deck](https://github.com/nicobailon/pi-design-deck) (MIT): alternatives from different designers, for `frontend-design`.
- [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config) `web-debug` (no licence, so ideas only): browser debugging playbooks, for `browser-check`.
- [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) (MIT): the layout and keys of the `/agents` panel.
- [giuseppecrj/pi-herdr-agents](https://github.com/giuseppecrj/pi-herdr-agents) (MIT): a process-wide registry that keeps child agents alive across `/reload`.
- [eleith/pi-extensions](https://github.com/eleith/pi-extensions) `web-search-codex` 0.1.2 (MIT): the request shape of the Codex search backend.
- [kenryu42/cc-safety-net](https://github.com/kenryu42/cc-safety-net) (MIT): example commands from its blocked-commands reference, used as a test corpus in `tests/guard-corpus.test.mjs`.
- Pi Durable (the pi team): the runner's rules for idempotent GitHub writes and restart limits.
- Martin Fowler, *Refactoring*, chapter 3: the code smells named in `code-review`.
- John Ousterhout, *A Philosophy of Software Design*, and Michael Feathers, *Working Effectively with Legacy Code*: deep modules and seams, in `codebase-design`.

Dependencies installed from npm keep their own licences in their packages; `UPSTREAM.md` lists them.

## MIT License

Applies to the MIT sources in section 1, with the copyright lines given there.

```
MIT License

Copyright (c) 2025-2026 Cloudflare, Inc.
Copyright (c) 2026 Matt Pocock
Copyright (c) 2026 Nico Bailon
Copyright (c) 2026 DietrichGebert
Copyright (c) 2025 Addy Osmani
Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Apache License 2.0

Applies to the google/elephant-goldfish-model material in section 1.

```

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
