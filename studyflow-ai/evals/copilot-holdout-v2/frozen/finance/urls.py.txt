from django.urls import path, include
from .views import SourceListView, StateView, ForecastView
urlpatterns = [
    path('', include('finance.copilot.api')),
    path('', include('finance.support_api')),
    path("readiness/", include("finance.readiness.api")),
    path("", include("finance.lending_urls")),
    path("", include("finance.workflow_urls")),
    path("sources/", SourceListView.as_view(), name="sources"),
    path("state/", StateView.as_view(), name="state"),
    path("forecasts/", ForecastView.as_view(), name="forecasts"),
]
