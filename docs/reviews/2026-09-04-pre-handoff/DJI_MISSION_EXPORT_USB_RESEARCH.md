# DJI mission exports and USB transfer

Reviewed 2026-09-05, approximately 00:27-00:40 UTC. This is primary-source research and a narrow source inspection, not a hardware test. No USB device, aircraft, controller, application account, browser session or running OpenPlan service was accessed. Exact aircraft, payload, controller and app version remain unknown; the lead agent has requested them.

## Recommended product behavior

Provide separate downloads for a survey-area KML, a review-only route KML, and a mission package built for an explicitly supported aircraft/controller/app profile. For a verified DJI Pilot 2 profile, that mission package should be DJI WPML in a KMZ archive. Offer instructions for copying the chosen file to the controller through the user's computer and importing it in the controller app. Add an optional local transfer adapter only after proving the exact device/OS combination.

The user wants a useful transfer workflow. Preserve that requirement, but do not label a downloaded file as transferred, a copied file as imported, or an imported mission as flight-validated. A single button that promises to upload a generic KML to any DJI controller would misrepresent what the official documentation supports.

A first supported device profile should be the user's actual equipment. Missing equipment details do not block work on format validation, download behavior, documentation or the compatibility model. They do block a truthful claim that the final file works on that controller.

## File meanings and app compatibility

| App or product family | Officially documented import behavior | OpenPlan consequence |
| --- | --- | --- |
| DJI Pilot 2 on a compatible enterprise combination, including relevant RC Plus or RC Pro Enterprise configurations | KML survey geometry and complete KMZ route packages are distinct import cases | Use KML for the survey boundary and WPML/KMZ for an executable-route candidate. Verify the exact profile. |
| Consumer DJI Fly, regardless of a controller having a similar name | DJI explicitly says KML flight-route import is unsupported | Do not advertise Pilot 2 export as DJI Fly compatible. No supported arbitrary KMZ import method was established in this research. |
| Legacy DJI Pilot | Separate KML workflow | Treat as a separate versioned profile, not an alias for Pilot 2. |
| DJI GS RTK, including applicable Phantom 4 RTK setups | Survey geometry import has its own SD-card workflow | A boundary import is not an imported waypoint mission. |
| DJI GS Pro on iPad | GIS geometries can become missions in GS Pro | Treat its local network/iPad file import and supported aircraft as a separate integration. |
| Other third-party flight apps | Not audited here | Require the app's own current compatibility and import evidence. A CSV or KMZ extension alone proves nothing. |

DJI's enterprise import/export help distinguishes Pilot 2 KML boundaries from complete KMZ routes containing `wpmz/template.kml` and `wpmz/waylines.wpml`. Files can first reach the controller through a computer, SD card or USB stick. The app then imports them through its route library's plus menu and KMZ/KML import action. Boundary imports require a mission-type choice. RC Plus 2 currently requires USB-stick files to be copied to controller-local storage before import. The page limits batch imports of third-party files. Its legacy Pilot and GS RTK sections describe different formats and workflows. This summary translates the official Chinese article; the English variant failed to load. [DJI enterprise import/export help](https://repair.dji.com/help/content?customId=01700043570&lang=zh-CN&paperDocType=ARTICLE&re=CN&spaceId=17)

For an English model-specific example, DJI's Mavic 3M support page documents selecting the file from internal storage or an SD card using the route import interface. This supports the app-driven file-selection workflow, not universal support for all hardware. [DJI Mavic 3M support](https://www.dji.com/support/product/mavic-3-m)

DJI Fly's waypoint help explicitly rejects KML route import. It also says waypoint missions cannot currently be exported; cloud upload/download starts at Fly 1.17.0 except in the United States. The same page retains an older blanket statement that missions cannot transfer between devices, so the newer qualified statement matters. This is not an officially documented arbitrary third-party KMZ import interface. Do not base v1 compatibility on replacing undocumented files inside Fly's application storage. [DJI Fly waypoint help](https://repair.dji.com/help/content?customId=01700007343&documentType=&lang=en&paperDocType=ARTICLE&re=US&spaceId=17)

GS Pro documents GIS-file upload through a browser connected to the app's local import address, or opening downloaded files on the iPad. It can generate missions from imported geometries; reference points do not become flight missions. Its supported coordinate system is WGS84. This is a separate workflow from controller USB transfer. App availability, entitlement and current aircraft support were not tested. [DJI GS Pro GIS import](https://www.dji.com/ground-station-pro/gis-data-import)

## Executable mission package requirements

DJI WPML uses a ZIP archive with a `.kmz` suffix. `template.kml` carries editable planning information; `waylines.wpml` carries execution instructions; the resource folder supplies auxiliary files when needed. Merely zipping arbitrary KML does not generate those instructions. The current FlightHub 2 route-import page explicitly requires both named files. FlightHub is evidence about the package format, not a proposed paid/cloud dependency. [DJI WPML overview](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/overview.html), [FlightHub 2 route import, dated 2026-06-16](https://fh.dji.com/user-manual/en/flight-route-library/import-flight-routes.html)

Current DJI Common Elements documentation marks `droneEnumValue`, `payloadEnumValue` and `payloadPositionIndex` required. It specifically makes `droneSubEnumValue` required for drone type 67, M30/M30T. Container rows in the mission-configuration tables defer to Common Elements and show a dash for requiredness. These tables contradict any assumption that model identification is irrelevant, but do not by themselves establish that every Pilot 2 version rejects every incomplete package. I found no primary statement guaranteeing that Pilot 2 binds an unidentified package automatically on import. [DJI Common Elements](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/common-element.html), [DJI template format](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/template-kml.html)

Use a versioned registry for aircraft/payload identifiers, supported mission types, lens and mount selection, firmware/app constraints and tested field combinations. A rule against geographic hardcoding does not prohibit a correct vendor-specific export profile. Unknown identifiers should produce an unsupported profile state, not invented values or an implicit default aircraft.

Height semantics are consequential. DJI separates the execution height mode from template/editor height representation. Its waypoint documentation distinguishes WGS84 ellipsoid height from height relative to the takeoff point. A constant relative-to-takeoff height must not be presented as terrain-following or a guaranteed height above ground throughout the route. Required global mission settings and template fields also need validation for the chosen profile. [DJI waylines format](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/waylines-wpml.html)

### What the source currently says

Read-only inspection found `FlightExportFormat = "wpml" | "litchi" | "kml"` in `openplan/src/lib/aerial/flight-exports.ts`, and the download route under `src/app/api/aerial/missions/[missionId]/flight-plan/export/route.ts`. The generic KML is correctly described as review-only GIS lines and photo points. It is not the same thing as a simple survey-boundary export.

The WPML header at lines 13-17 deliberately omits aircraft and payload identification and asserts automatic binding in Pilot 2. That assertion is unsupported by the reviewed primary evidence. `buildWpmlTemplate`, near line 390, creates timestamps and mission configuration without a template `Folder`; the documentation describes template information inside `Folder`. `buildWpmlWaylines` explicitly uses `relativeToStartPoint`. These are source findings requiring the aerial code owner's detailed validation, not a reproduced controller rejection. The ZIP paths alone cannot establish an editable or executable mission.

## USB transfer and operating systems

| Computer environment | Evidence available | Support boundary |
| --- | --- | --- |
| Windows | DJI shows RC Plus attached by USB-C, appearing in This PC with internal shared storage. Microsoft's WPD supports MTP and mass-storage devices. | Manual file copy is a reasonable first workflow on supported hardware. Verify write/import, since DJI's RC Plus example exports logs rather than imports missions. |
| Linux, including the user's KDE computer | KDE has an MTP component and libmtp provides MTP access. | This establishes available OS tooling, not that the unknown DJI controller works on this installation. Test device discovery, copying and app import later. Do not assume a visible MTP device is a mounted filesystem path. |
| macOS | DJI acknowledges Android controller recognition issues and points to Android File Transfer. | That linked URL now redirects to Windows Quick Share. The published remedy is stale. A current, verified MTP client or supported SD-card method is required before documenting a working Mac recipe. |
| Removable SD card or USB stick | Pilot 2 documentation supports file staging on suitable removable storage, subject to controller exceptions. | OS-visible removable storage may be simpler than controller MTP. This is an explicit fallback, not fulfillment of direct controller USB transfer. |

DJI's RC Plus example names `This PC > DJI RC Plus > Internal shared storage` and uses a controller USB-C to computer USB-A cable. The referenced `DJI/com.dji.industry.pilot/FlightRecord` folder is a log-export location, not a mission-import destination. Do not copy mission packages into it. Use a user-selected ordinary staging directory that the controller app can browse, then record the verified path in the device profile. [DJI Pilot 2 flight-record export guide](https://repair.dji.com/help/content?customId=01700010206&documentType=&lang=en&paperDocType=ARTICLE&re=US&spaceId=17)

The RC Plus manual says there are different controller versions matched to aircraft and that USB-A accessory functions can vary. A connector's presence does not establish every function. [DJI RC Plus manual v2.0, 2023, pages 5 and 7](https://dl.djicdn.com/downloads/DJI_RC_Plus/20230518UM/DJI_RC_Plus_User_Manual_EN_v2.0I.pdf)

OS evidence: [Microsoft WPD driver overview, updated 2024-12-19](https://learn.microsoft.com/en-us/windows-hardware/drivers/portable/wpd-drivers-overview), [KDE current MTP source component](https://github.com/KDE/kio-extras/tree/master/mtp), [libmtp](https://github.com/libmtp/libmtp). These are architectural options only; no packages were installed or devices enumerated.

DJI's consumer RC media-transfer article is additional evidence of USB file access, but not proof that those controllers accept missions. Its Mac download reference failed the current-link check. [DJI RC media export help](https://repair.dji.com/help/content?customId=en-us03400006852&documentType=artical&lang=en&paperDocType=paper&re=US&spaceId=34), [old Android File Transfer URL, now redirected](https://www.android.com/filetransfer/)

### Browser boundaries

An ordinary hosted OpenPlan page cannot treat a USB cable as unrestricted access to controller storage. WebUSB requires a secure context, user activation and device permission. Its protected interface classes include mass storage. Current specification exceptions for `usb-unrestricted` apply to declared Isolated Web Apps, not a normal website. MTP is a distinct protocol, so it would also be wrong to claim every MTP interface is prohibited merely because mass storage is protected. An MTP implementation would still need browser/driver compatibility and exclusive device access. [Chrome WebUSB guidance](https://developer.chrome.com/docs/capabilities/usb), [WebUSB specification](https://wicg.github.io/webusb/)

The File System Access API can save through a user-selected supported filesystem location. It requires permission and user activation; it is not a universal MTP adapter. A controller's appearance in an OS file manager does not prove it can be selected or written through every browser's save dialog. Keep ordinary downloads available when those capabilities are absent. [Chrome File System Access guidance](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

If direct transfer merits a helper, keep it local and explicitly paired to the OpenPlan origin. Accept only the chosen export and destination, verify its hash after copying, avoid overwriting existing missions, and report an interrupted copy honestly. Do not enable debugging, replace drivers, change firmware or write private app databases as routine setup. Sharing installation infrastructure with the future native agent runner may reduce packaging work, but device transfer must have a separate permission from agent execution. These are proposed design boundaries, not existing behavior.

## Acceptance evidence required before claiming support

1. Record the aircraft, controller variant, payload/lens, controller OS, app version, firmware, computer OS and transfer method. Keep the tested combination distinct from unsupported or untested combinations.
2. Parse generated files independently, verify archive paths and XML namespaces, and compare geometry, units, elevations, actions and mission settings against the saved plan. Include omitted required fields, wrong identifiers, malformed archives and harmless mutations that must survive.
3. On authorized hardware later, copy a disposable, uniquely named file without overwriting other work. Confirm copied bytes where access allows, import through the actual controller app, and reopen the saved mission. Collect screenshots or an operator record of dimensions, altitude mode, route order and camera actions. Do not press GO or initiate aircraft upload/execution for an import-only acceptance check.
4. Export the imported mission back where supported and compare semantics, not just file bytes, because DJI may rewrite timestamps, identifiers or ordering. Record changed defaults and any settings the app required the operator to supply.
5. Prove useful recovery for disconnect, charging-only cable, denied access, inaccessible folder, full storage, unsupported profile and app rejection. Separate file-generated, copied, imported, preview-reviewed and flight-validated states. Import-only evidence must never produce the last state.
6. Repeat the supported workflow on each claimed computer OS. If direct USB support is absent on one, label the SD/manual alternative precisely.

The actual equipment and controller import result are still missing. No flight, firmware update, USB operation or runtime acceptance test took place in this review.

## Source dating and limits

DJI's web WPML pages were search-indexed with a 2026-03-19 date, but direct page rendering sometimes returned only a JavaScript shell. Tables were cross-checked against the official public source repository where available. That repository's observed master was `4ec6b0c7f9472aeb09a0a47949855d19c473ea07`, dated 2024-11-07, and must not be described as the current 2026 web specification. [Pinned older Common Elements source](https://github.com/dji-sdk/Cloud-API-Doc/blob/4ec6b0c7f9472aeb09a0a47949855d19c473ea07/docs/en/60.api-reference/00.dji-wpml/40.common-element.md), [pinned older waylines source](https://github.com/dji-sdk/Cloud-API-Doc/blob/4ec6b0c7f9472aeb09a0a47949855d19c473ea07/docs/en/60.api-reference/00.dji-wpml/30.waylines-wpml.md).

DJI support pages did not expose reliable publication dates; they are dated by this retrieval, not assumed newly published. Search results from forums and vendors were not used to establish official compatibility. No claim is made that all DJI documents or controller generations were reviewed.
