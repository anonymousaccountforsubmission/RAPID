# Data sources and limitations

RAPID combines live observations with versioned reference data. “Realtime” in the interface refers to meteorology and newly evaluated model output, not continuous emissions monitoring.

| Input | Source | Update behavior |
| --- | --- | --- |
| Weather | [National Weather Service API](https://www.weather.gov/documentation/services-web-api), station KHOU | Requested at startup and every five minutes |
| Point sources | Curated project snapshot based on [EPA National Emissions Inventory](https://www.epa.gov/air-emissions-inventories/national-emissions-inventory-nei) and public Title V records | Versioned with the repository |
| Community indicators | Curated project snapshot based on US Census Bureau ACS and public health datasets | Versioned with the repository |
| Air comparison values | EPA NAAQS, EPA IRIS risk-screening values, and [TCEQ air monitoring comparison values](https://www.tceq.texas.gov/toxicology/amcv) | Reviewed when the project dataset is updated |

The included geographic polygons are simplified for fast mobile rendering and should not be used as legal tract boundaries. Point-source quantities and model estimates are intended for screening, education, and scenario comparison. They are not compliance determinations.

When NOAA is unreachable, the API marks the pipeline as `degraded` and returns a meteorological baseline with an error field. The interface continues to work, but the fallback must not be interpreted as a current observation.
