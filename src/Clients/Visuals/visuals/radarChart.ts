/*
 *  Power BI Visualizations
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved. 
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *   
 *  The above copyright notice and this permission notice shall be included in 
 *  all copies or substantial portions of the Software.
 *   
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE 
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */

/* Please make sure that this path is correct */

/// <reference path="../_references.ts"/>

module powerbi.visuals {
    //import SelectionManager = utility.SelectionManager;

    export interface RadarChartDataPoint {
        value: number;
        categoryIndex: number;
        seriesIndex: number;
        color: any;
    }

    export interface RadarChartSeries {
        displayName: string;
        key: string;
        index: number;
        data: RadarChartDataPoint[];
        identity: DataViewScopeIdentity;
        color: string;
    }

    export interface RadarChartData {
        series: RadarChartSeries[];
        categories: any[];
        values: RadarChartDataPoint[];
    }

    export interface RadarChartSettings {
        width: number;
        height: number;
        catTotal: number;
        catAxis: any[];
        radius: number;
        nodeRadius: number;
        levels: number;
        levelsFormat: any;
        maxValue: any;
    }

    export class RadarChart implements IVisual {
        public static capabilities: VisualCapabilities = {
            dataRoles: [
                {
                    name: 'Category',
                    kind: VisualDataRoleKind.Grouping,
                    displayName: data.createDisplayNameGetter('Role_DisplayName_Category'),
                }, {
                    name: 'Series',
                    kind: VisualDataRoleKind.Grouping,
                    displayName: data.createDisplayNameGetter('Role_DisplayName_Series'),
                }, {
                    name: 'Y',
                    kind: VisualDataRoleKind.Measure,
                    displayName: data.createDisplayNameGetter('Role_DisplayName_Value'),
                }
            ],
            dataViewMappings: [{
                conditions: [
                    { 'Category': { max: 1 }, 'Series': { max: 0 } },
                    { 'Category': { max: 1 }, 'Series': { min: 1, max: 1 }, 'Y': { max: 1 } },
                    { 'Category': { max: 1 }, 'Series': { max: 0 }, 'Y': { min: 0, max: 1 } },
                ],
                categorical: {
                    categories: {
                        for: { in: 'Category' },
                        dataReductionAlgorithm: { top: {} }
                    },
                    values: {
                        group: {
                            by: 'Series',
                            select: [{ bind: { to: 'Y' } }],
                            dataReductionAlgorithm: { top: {} }
                        }
                    },
                    rowCount: { preferred: { min: 2 }, supported: { min: 0 } }
                },
            }],
            objects: {
                general: {
                    displayName: data.createDisplayNameGetter('Visual_General'),
                    properties: {
                        formatString: {
                            type: { formatting: { formatString: true } },
                        },
                    },
                },
                nodes: {
                    displayName: 'Nodes',
                    properties: {
                        show: {
                            displayName: 'Show',
                            type: { bool: true }
                        },
                        sizeFactor: {
                            displayName: 'Size factor',
                            type: { numeric: true }
                        },
                    },
                },
                categoryAxis: {
                    displayName: 'Category axis',//data.createDisplayNameGetter('Visual_CategoryAxis2'),
                    properties: {
                        show: {
                            displayName: data.createDisplayNameGetter('Visual_Show'),
                            type: { bool: true }
                        },
                    }
                },
                levelAxis: {
                    displayName: 'Level axis',//data.createDisplayNameGetter('Visual_LevelAxis'),
                    properties: {
                        show: {
                            displayName: data.createDisplayNameGetter('Visual_Show'),
                            type: { bool: true }
                        },
                        segments: {
                            displayName: 'Segments',
                            type: { numeric: true }
                        },
                    }
                },
                dataPoint: {
                    displayName: data.createDisplayNameGetter('Visual_DataPoint'),
                    properties: {
                        defaultColor: {
                            displayName: data.createDisplayNameGetter('Visual_DefaultColor'),
                            type: { fill: { solid: { color: true } } }
                        },
                        showAllDataPoints: {
                            displayName: data.createDisplayNameGetter('Visual_DataPoint_Show_All'),
                            type: { bool: true }
                        },
                        fill: {
                            displayName: data.createDisplayNameGetter('Visual_Fill'),
                            type: { fill: { solid: { color: true } } }
                        },
                    },
                },
            },
            supportsHighlight: true,
            sorting: {
                default: {},
            },
            drilldown: {
                roles: ['Category']
            },
        };

        private static VisualClassName = 'radarChart';
        private static Factor = 1;
        private static FactorLegend = 0.85;
        private static OpacityArea = 0.5;
        private static ToRight = 0.5;
        private static TranslateX = 80;
        private static TranslateY = 30;
        private static TwoPI = 2 * Math.PI;
        private static FontFamily = 'wf_segoe-ui_normal';
        private static FontSize = '14px';
        private static FontSizeSmall = '12px';
        private static MarginFactor = 0.85;

        private svg: D3.Selection;
        private dataGraphicsContext: D3.Selection;
        private axisGraphicsContext: D3.Selection;
        private selectionManager: SelectionManager;
        private dataView: DataView;
        private data: RadarChartData;
        private viewPort: IViewport;
        private colors: IDataColorPalette;
        private settings: RadarChartSettings;

        public static converter(dataView: DataView, colors: IDataColorPalette): RadarChartData {
            var categorical = dataView.categorical;
            var category = categorical.categories[0];
            var categoryValues = category.values;
            var seriesLen = categorical.values ? categorical.values.length : 0;
            var series: RadarChartSeries[] = [];
            var values: RadarChartDataPoint[] = [];
            var toolTipItems = [];

            var grouped: DataViewValueColumnGroup[];
            if (dataView.categorical.values)
                grouped = dataView.categorical.values.grouped();

            for (var seriesIndex = 0; seriesIndex < seriesLen; seriesIndex++) {
                var serie = categorical.values[seriesIndex];
                var valuesMetadata = serie.source;
                var dataPoints: RadarChartDataPoint[] = [];
                var groupedIdentity = grouped[seriesIndex];

                var formatStringProp = <DataViewObjectPropertyIdentifier>{ objectName: 'general', propertyName: 'formatString' };
                var categorySourceFormatString = valueFormatter.getFormatString(category.source, formatStringProp);
                var formattedCategoryValue = valueFormatter.format(categoryValues[seriesIndex], categorySourceFormatString);

                for (var valueIndex = 0; valueIndex < serie.values.length; valueIndex++) {
                    var categoryValue = categoryValues[valueIndex];
                    var value = serie.values[valueIndex];

                    var radarChartDataPoint: RadarChartDataPoint = {
                        value: value,
                        categoryIndex: valueIndex,
                        seriesIndex: seriesIndex,
                        color: colors.getColorByIndex(seriesIndex).value
                    };

                    dataPoints.push(radarChartDataPoint);
                    values.push(radarChartDataPoint)
                }

                var dvValues = dataView.categorical.values;
                var legendTitle = dvValues && dvValues.source ? dvValues.source.displayName : "";

                if (dataPoints.length > 0) {
                    var serieInput: RadarChartSeries = {
                        displayName: legendTitle,
                        key: "Serie" + seriesIndex,
                        index: seriesIndex,
                        data: dataPoints,
                        identity: serie.identity,
                        color: colors.getColorByIndex(seriesIndex).value,
                    };
                    series.push(serieInput);
                }
            }

            return {
                categories: categoryValues,
                series: series,
                values: values
            };
        }

        public init(options: VisualInitOptions): void {
            var element = options.element;
            this.selectionManager = new SelectionManager({ hostServices: options.host });
            var svg = this.svg = d3.select(element.get(0))
                .append('svg')
                .classed(RadarChart.VisualClassName, true);

            this.axisGraphicsContext = svg.append('g');
            this.dataGraphicsContext = svg.append('g');
            this.colors = options.style.colorPalette.dataColors;
        }

        public update(options: VisualUpdateOptions) {
            if (!options.dataViews || !options.dataViews[0]) return; // or clear the view, display an error, etc.
            var dataView = this.dataView = options.dataViews[0];
            var data = this.data = RadarChart.converter(dataView, this.colors);
            var duration = options.suppressAnimations ? 0 : AnimatorCommon.MinervaAnimationDuration;
            var viewport = options.viewport;

            var radius = RadarChart.Factor * Math.min(viewport.width / 2, viewport.height / 2) * RadarChart.MarginFactor;
            var settings = this.settings = {
                width: viewport.width,
                height: viewport.height,
                catTotal: data.categories.length,
                catAxis: this.data.categories,
                radius: radius,
                nodeRadius: (radius * this.getSizeFactorNodes(this.dataView)) / 100,
                levels: this.getSegmentsLevelAxis(this.dataView),
                levelsFormat: d3.format(this.getFormatLevelAxis(this.dataView)),
                maxValue: d3.max(data.values.map(p => p.value)),
            }

            this.svg
                .attr("width", viewport.width)
                .attr("height", viewport.height)

            var axisGraphicsElement = this.axisGraphicsContext;
            var dataGraphicsElement = this.dataGraphicsContext;
            axisGraphicsElement.selectAll("*").remove();
            dataGraphicsElement.selectAll("*").remove();

            this.drawAxis();
            this.drawData();
        }

        private drawAxis() {
            var settings = this.settings;

            var axisGraphicsElement = this.axisGraphicsContext;
            if (this.getShowLevelAxis(this.dataView)) {
                //Circular level segments
                for (var j = 0; j < settings.levels; j++) {
                    for (var i = 0; i < settings.catTotal; i++) {
                        var levelFactor = settings.radius * ((j + 1) / settings.levels);
                        axisGraphicsElement.append("svg:line")
                            .classed("line", true)
                            .attr("x1", levelFactor * (1 - RadarChart.Factor * Math.sin(i * RadarChart.TwoPI / settings.catTotal)))
                            .attr("y1", levelFactor * (1 - RadarChart.Factor * Math.cos(i * RadarChart.TwoPI / settings.catTotal)))
                            .attr("x2", levelFactor * (1 - RadarChart.Factor * Math.sin((i + 1) * RadarChart.TwoPI / settings.catTotal)))
                            .attr("y2", levelFactor * (1 - RadarChart.Factor * Math.cos((i + 1) * RadarChart.TwoPI / settings.catTotal)))
                            .attr("class", "line")
                            .style("stroke", "grey")
                            .style("stroke-opacity", "0.75")
                            .style("stroke-width", "0.3px")
                            .attr("transform", "translate(" + (settings.width / 2 - levelFactor) + ", " + (settings.height / 2 - levelFactor) + ")");
                    }
                }
                            
                //Text indicating at what % each level is
                for (var j = 0; j < (settings.levels - 1); j++) {
                    var levelFactor = settings.radius * ((j + 1) / settings.levels);
                    axisGraphicsElement.append("svg:text")
                        .attr("x", levelFactor * (1 - RadarChart.Factor * Math.sin(0)))
                        .attr("y", levelFactor * (1 - RadarChart.Factor * Math.cos(0)))
                        .attr("class", "legend")
                        .style("font-family", RadarChart.FontFamily)
                        .style("font-size", RadarChart.FontSizeSmall)
                        .attr("transform", "translate(" + (settings.width / 2 - levelFactor + RadarChart.ToRight) + ", " + (settings.height / 2 - levelFactor) + ")")
                        .attr("fill", "#737373")
                        .text(settings.levelsFormat((j + 1) * settings.maxValue / settings.levels));
                }
            }

            if (this.getShowCategoryAxis(this.dataView)) {
                //Categories radious 
                for (var i = 0; i < settings.catTotal; i++) {
                    axisGraphicsElement.append("svg:line")
                        .attr("x1", settings.radius)
                        .attr("y1", settings.radius)
                        .attr("x2", settings.radius * (1 - RadarChart.Factor * Math.sin(i * RadarChart.TwoPI / settings.catTotal)))
                        .attr("y2", settings.radius * (1 - RadarChart.Factor * Math.cos(i * RadarChart.TwoPI / settings.catTotal)))
                        .attr("class", "line")
                        .style("stroke", "grey")
                        .style("stroke-width", "1px")
                        .attr("transform", "translate(" + (settings.width / 2 - settings.radius) + ", " + (settings.height / 2 - settings.radius) + ")");
                }
                
                //Draw axis labels
                var axisLabels = axisGraphicsElement.selectAll(".axis")
                    .data(settings.catAxis);
                
                //Categories text labels
                axisLabels.enter()
                    .append("text")
                    .attr("class", "legend")
                    .text(function (d) { return d; })
                    .style("font-family", RadarChart.FontFamily)
                    .style("font-size", RadarChart.FontSize)
                    .attr("text-anchor", "middle")
                    .attr("dy", "1.5em")
                    .attr("x", function (d, i) { return settings.radius * (1 - RadarChart.FactorLegend * Math.sin(i * RadarChart.TwoPI / settings.catTotal)) - 70 * Math.sin(i * RadarChart.TwoPI / settings.catTotal); })
                    .attr("y", function (d, i) { return settings.radius * (1 - RadarChart.FactorLegend * Math.cos(i * RadarChart.TwoPI / settings.catTotal)) - 70 * Math.cos(i * RadarChart.TwoPI / settings.catTotal); })
                    .attr("transform", "translate(" + (settings.width / 2 - settings.radius) + ", " + (settings.height / 2 - settings.radius - 15) + ")");
            }
        }

        private drawData() {
            var settings = this.settings;
            var dataGraphicsElement = this.dataGraphicsContext;
            dataGraphicsElement.attr("transform", "translate(" + (settings.width / 2 - settings.radius) + ", " + (settings.height / 2 - settings.radius) + ")")

            var dataValues = [];
            for (var j = 0; j < this.data.series.length; j++) {
                var dataValues = [];
                dataGraphicsElement.selectAll(".nodes")
                    .data(this.data.series[j].data, function (j, i) {
                        dataValues.push([
                            settings.radius * (1 - (Math.max(j.value, 0) / settings.maxValue) * RadarChart.Factor * Math.sin(i * RadarChart.TwoPI / settings.catTotal)),
                            settings.radius * (1 - (Math.max(j.value, 0) / settings.maxValue) * RadarChart.Factor * Math.cos(i * RadarChart.TwoPI / settings.catTotal))
                        ]);
                    });
                dataValues.push(dataValues[0]);

                dataGraphicsElement.selectAll(".area")
                    .data([dataValues])
                    .enter()
                    .append("polygon")
                    .attr("class", "radar-chart-serie" + j)
                    .style("stroke-width", "2px")
                    .style("stroke", this.colors.getColorByIndex(j).value)
                    .attr("points", function (d) {
                        var str = "";
                        for (var pti = 0; pti < d.length; pti++) {
                            str = str + d[pti][0] + "," + d[pti][1] + " ";
                        }
                        return str;
                    })
                    .style("fill", this.colors.getColorByIndex(j).value)
                    .style("fill-opacity", RadarChart.OpacityArea)
                    .on('mouseover', function (d) {
                        var z = "polygon." + d3.select(this).attr("class");
                        dataGraphicsElement.selectAll("polygon")
                            .transition()
                            .duration(200)
                            .style("fill-opacity", 0.1);
                        dataGraphicsElement.selectAll(z)
                            .transition()
                            .duration(200)
                            .style("fill-opacity", .7);
                    })
                    .on('mouseout', function () {
                        dataGraphicsElement.selectAll("polygon")
                            .transition()
                            .duration(200)
                            .style("fill-opacity", RadarChart.OpacityArea);
                    });
            }

            if (this.getShowNodes(this.dataView)) {
                var dataGraphicsNodesElement = dataGraphicsElement.selectAll(".nodes")
                    .data(this.data.values);

                dataGraphicsNodesElement.enter()
                    .append("svg:circle")
                    .attr("class", "radar-chart-serie1")
                    .attr('r', settings.nodeRadius)
                    .attr("alt", function (j) { return Math.max(j.value, 0) })
                    .attr("cx", function (j, i) {
                        return settings.radius * (1 - (Math.max(j.value, 0) / settings.maxValue) * RadarChart.Factor * Math.sin(i * RadarChart.TwoPI / settings.catTotal));
                    })
                    .attr("cy", function (j, i) {
                        return settings.radius * (1 - (Math.max(j.value, 0) / settings.maxValue) * RadarChart.Factor * Math.cos(i * RadarChart.TwoPI / settings.catTotal));
                    })
                    .style("fill", function (j) { return j.color; })
                    .style("fill-opacity", .9)
            }
        }

        // This function returns the values to be displayed in the property pane for each object.
        // Usually it is a bind pass of what the property pane gave you, but sometimes you may want to do
        // validation and return other values/defaults
        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] {
            var instances: VisualObjectInstance[] = [];
            switch (options.objectName) {
                case 'nodes':
                    var nodes: VisualObjectInstance = {
                        objectName: 'nodes',
                        displayName: 'Nodes',
                        selector: null,
                        properties: {
                            show: this.getShowNodes(this.dataView),
                            sizeFactor: this.getSizeFactorNodes(this.dataView)
                        }
                    };
                    instances.push(nodes);
                    break;
                case 'categoryAxis':
                    var categoryAxis: VisualObjectInstance = {
                        objectName: 'categoryAxis',
                        displayName: 'Category axis',
                        selector: null,
                        properties: {
                            show: this.getShowCategoryAxis(this.dataView),
                        }
                    };
                    instances.push(categoryAxis);
                    break;
                case 'levelAxis':
                    var categoryAxis: VisualObjectInstance = {
                        objectName: 'levelAxis',
                        displayName: 'Level axis',
                        selector: null,
                        properties: {
                            show: this.getShowLevelAxis(this.dataView),
                            segments: this.getSegmentsLevelAxis(this.dataView)
                        }
                    };
                    instances.push(categoryAxis);
                    break;
            }
            return instances;
        }
                               
        //Properties
        private getShowNodes(dataView: DataView): boolean {
            if (dataView && dataView.metadata.objects) {
                var nodes = dataView.metadata.objects['nodes'];
                if (nodes) {
                    return <boolean>nodes['show'];
                }
            }
            return true;
        }

        private getSizeFactorNodes(dataView: DataView): number {
            if (dataView && dataView.metadata.objects) {
                var nodes: DataViewObject = dataView.metadata.objects['nodes'];
                if (nodes) {
                    var sizeFactor = <number>nodes['sizeFactor'];
                    if (sizeFactor !== undefined) {
                        return sizeFactor;
                    }
                }
            }
            return 4;
        }

        private getShapeNodes(dataView: DataView): string {
            if (dataView && dataView.metadata.objects) {
                var nodes: DataViewObject = dataView.metadata.objects['nodes'];
                if (nodes) {
                    var shape = <string>nodes['shape'];
                    if (shape !== undefined) {
                        return shape;
                    }
                }
            }
            return 'square';
        }

        private getShowLevelAxis(dataView: DataView): boolean {
            if (dataView && dataView.metadata.objects) {
                var levelAxis = dataView.metadata.objects['levelAxis'];
                if (levelAxis) {
                    return <boolean>levelAxis['show'];
                }
            }
            return true;
        }

        private getFormatLevelAxis(dataView: DataView): string {
            if (dataView && dataView.metadata.objects) {
                var levelAxis = dataView.metadata.objects['levelAxis'];
                if (levelAxis) {
                    return <string>levelAxis['format'];
                }
            }
            return '%';
        }

        private getSegmentsLevelAxis(dataView: DataView): number {
            if (dataView && dataView.metadata.objects) {
                var levelAxis: DataViewObject = dataView.metadata.objects['levelAxis'];
                if (levelAxis) {
                    var segments = <number>levelAxis['segments'];
                    if (segments !== undefined) {
                        return segments;
                    }
                }
            }
            return 4;
        }

        private getShowCategoryAxis(dataView: DataView): boolean {
            if (dataView && dataView.metadata.objects) {
                var categoryAxis = dataView.metadata.objects['categoryAxis'];
                if (categoryAxis) {
                    return <boolean>categoryAxis['show'];
                }
            }
            return true;
        }
    }
}