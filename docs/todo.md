1. 菜单里的星系搜索功能，确认现在的逻辑，是否为管理员可以在列表中看见所有的星系，而普通成员只能看到他的订阅地图中渲染的星系。

2. 菜单里的show on the map的功能，确认现在的逻辑，是否为管理员可以在列表中看见所有的星系和成员，而普通成员只能看到他的订阅地图中渲染的星系族和成员。


结合下面的日志以及官方文档https://developers.eveonline.com/docs/services/esi/rate-limiting/ 中的关于频次限制的说明，确认现在的API调用方式是否合理以及是否存在问题。偶发性的角色的位置不更新和这个有关吗？
07:50:43.256 application=wanderer_app module=WandererApp.Map.Server.CharactersImpl function=remove_and_untrack_characters/2 line=315 [info] [CharacterCleanup] Map baed4fc4-77eb-4621-a6ab-b8bc6960e47e - starting removal of 4 characters: ["e59dd6f7-d45e-4cc1-bbc5-b02e109e8360", "ef39f18b-b3e1-4e0d-ac36-e6a18b115515", "8679f33a-b886-4f3e-ba26-0c82050db7f6", "f6ad55a2-a048-41b2-b795-1825d99777e7"]
07:50:43.259 application=wanderer_app module=WandererApp.Map.Server.CharactersImpl function=remove_and_untrack_characters/2 line=335 [info] [CharacterCleanup] Map baed4fc4-77eb-4621-a6ab-b8bc6960e47e - untracking settings and removing character 8679f33a-b886-4f3e-ba26-0c82050db7f6
07:50:43.262 application=wanderer_app module=WandererApp.Map.Server.CharactersImpl function=remove_and_untrack_characters/2 line=335 [info] [CharacterCleanup] Map baed4fc4-77eb-4621-a6ab-b8bc6960e47e - untracking settings and removing character e59dd6f7-d45e-4cc1-bbc5-b02e109e8360
07:50:43.267 application=wanderer_app module=WandererApp.Map.Server.CharactersImpl function=remove_and_untrack_characters/2 line=335 [info] [CharacterCleanup] Map baed4fc4-77eb-4621-a6ab-b8bc6960e47e - untracking settings and removing character ef39f18b-b3e1-4e0d-ac36-e6a18b115515
07:50:43.271 application=wanderer_app module=WandererApp.Map.Server.CharactersImpl function=remove_and_untrack_characters/2 line=335 [info] [CharacterCleanup] Map baed4fc4-77eb-4621-a6ab-b8bc6960e47e - untracking settings and removing character f6ad55a2-a048-41b2-b795-1825d99777e7
07:53:30.595 application=wanderer_app module=WandererAppWeb.MapCoreEventHandler function=handle_map_server_started/1 line=630 [info] [handle_map_server_started] map_id=35b80570-5303-4739-9ab7-6a4c7788919a
07:53:30.596 application=wanderer_app module=WandererAppWeb.MapCoreEventHandler function=map_start/3 line=757 [info] [map_start] map_id=35b80570-5303-4739-9ab7-6a4c7788919a
07:53:30.622 application=wanderer_app module=WandererAppWeb.MapCoreEventHandler function=map_start/3 line=787 [info] [map_start] map_id=35b80570-5303-4739-9ab7-6a4c7788919a connections=17 systems=29
07:53:45.601 application=wanderer_app module=WandererApp.Character.TrackerPool function=handle_info/2 line=302 [warning] [Tracker Pool] Location updates falling behind: 2554ms for 40 chars (pool: c177b236-9ac8-11f1-b208-02420aff0202)
07:54:46.030 application=wanderer_app module=WandererApp.Map.Server.ConnectionsImpl function=maybe_add_connection/6 line=697 [info] [maybe_add_connection] map_id=baed4fc4-77eb-4621-a6ab-b8bc6960e47e new_connection 31002359 -> 30003957 (id=ad2d41ff-d8c1-4168-bce9-9d7c908c2b8c)
07:55:37.668 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:37.668 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:37.670 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:37.827 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:37.827 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:37.899 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:38.668 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:38.669 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:38.669 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.532 application=wanderer_app module=WandererApp.Map.Reconciler function=reconcile_state/0 line=94 [info] [Map Reconciler] Reconciliation stats: %{cache_inconsistencies: 0, orphan_maps: 0, total_registry_maps: 2, total_started_maps: 2, zombie_maps: 0}
07:55:39.534 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.534 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.535 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.536 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.737 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.737 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.738 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.738 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.935 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.941 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.942 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.942 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:39.943 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:40.145 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:40.146 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:40.146 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
07:55:40.146 application=wanderer_app module=WandererApp.Esi.ApiClient function=do_get_request/4 line=383 [warning] ESI_RATE_LIMITED: GET request rate limited
