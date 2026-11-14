# Moon Trek (NASA/JPL), teselas WMTS (recurso oficial del reto)

Catálogo: https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon (secciones Equirectangular / North Pole / **South Pole**)

Plantilla (comprobada el 13/11/2026, **CORS `*`**, se puede usar directamente desde el navegador):
```
https://trek.nasa.gov/tiles/Moon/SP/{LAYER}/1.0.0/default/default028mm/{z}/{row}/{col}.png
https://trek.nasa.gov/tiles/Moon/SP/{LAYER}/1.0.0/WMTSCapabilities.xml
```
`SP` = estereográfica polar sur. Para el globo equirectangular se usa `EQ` (por ejemplo `LRO_WAC_Mosaic_Global_303ppd_v02`, en .jpg).

Capas del polo sur útiles para la app (los `.WMTSCapabilities.xml` de esta carpeta tienen la extensión y la matriz de teselas):
| Capa | Uso |
|---|---|
| `LRO_LOLA_Shade_SPole45_100mp_v04` | Mapa base sombreado (polo sur hasta 45°S) |
| `LRO_LOLA_ClrShade_SPole75_30mp_v04` | Relieve coloreado por altura a 30 m |
| `LRO_WAC_Mosaic_SPole60_100m_v02` | Mosaico de imagen real (LROC WAC) |
| `ClrAVGVISIB_85S_060M_201608_EARTH_SP` (también `_75S_120M_`, `_65S_240M_`) | Visibilidad media de la Tierra (Mazarico) |
| `LRO_LOLA_Illumination_SPole65S_240m`, `WAC_POLE_ILL_PCT_SOUTH_100M` | Iluminación media (LOLA / LROC) |
| `NAC_POLE_PSR_SOUTH_STRETCH` | Sombras permanentes vistas por la cámara NAC |
| `LOLA_RGB_Slope_below_{10,15,20}deg_SPole45` | Máscara de pendiente segura |
| `{Haworth,DM2,Site01..Site23}_final_adj_5mpp_ColorHillshade` | DEM de 5 m de los sitios candidatos (zoom de detalle) |
| `LRO_NAC_*_IM_1_LandingSite_SP`, `LRO_NAC_Mosaic_0_67mpp_Malapert_Massif_SP` | Imágenes de alta resolución de IM-1 y Malapert |

Nota: la API de **JPL Horizons NO tiene CORS**, así que hay que llamarla desde nuestro backend (proxy y caché).
